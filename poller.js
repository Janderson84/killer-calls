#!/usr/bin/env node
require("dotenv").config();

const { execSync } = require("child_process");
const { saveScorecard, updateSlackTs, pool } = require("./src/db");
const { fetchTranscript } = require("./src/fireflies-client");
const { postDemoReview, postKillerCall, calculateStallRisk } = require("./src/slack-formatter");
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("fs");
const path = require("path");
const { CONFIG } = require("./src/constants");
const { buildScoringPrompt } = require("./shared/scoring-prompts");

// ─── AE organizer emails ────────────────────────────────────────
const AE_EMAILS = [
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
];

const TMP_DIR = path.join(__dirname, ".tmp-transcripts");
const SKIP_FILE = path.join(__dirname, ".skipped-meetings.json");
const MIN_DURATION_MINUTES = 20;

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s+call|second\s+call|check[\s-]?in/i;
const AE_EMAIL_SET = new Set(AE_EMAILS.map((e) => e.toLowerCase()));

// ─── CLI flags ──────────────────────────────────────────────────
const RESCORE = process.argv.includes("--rescore");

// ─── Skipped meetings tracker ───────────────────────────────────
// Persists meeting IDs that were skipped (too short, no-show) so
// they aren't re-fetched and re-evaluated every poll cycle.

function loadSkippedIds() {
  try {
    if (existsSync(SKIP_FILE)) {
      return new Set(JSON.parse(readFileSync(SKIP_FILE, "utf8")));
    }
  } catch {}
  return new Set();
}

async function syncSkipFileFromDb() {
  const result = await pool.query(
    "SELECT meeting_id FROM skipped_meetings WHERE reason IN ('no-show', 'too short', 'rep_inactive')"
  );
  const ids = result.rows.map((r) => r.meeting_id);
  writeFileSync(SKIP_FILE, JSON.stringify(ids, null, 2));
  console.log(`  Synced skip file from DB: ${ids.length} entries`);
}

// ─── Fetch recent transcripts from Fireflies ────────────────────
const RECENT_TRANSCRIPTS_QUERY = `
  query RecentTranscripts($organizerEmail: String) {
    transcripts(organizer_email: $organizerEmail, limit: 50) {
      id
      title
      date
      organizer_email
    }
  }
`;

async function fetchRecentByOrganizer(email) {
  const apiKey = process.env.FIREFLIES_API_KEY;
  const response = await fetch(CONFIG.firefliesEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: RECENT_TRANSCRIPTS_QUERY,
      variables: { organizerEmail: email },
    }),
  });

  if (!response.ok) throw new Error(`Fireflies API ${response.status}`);
  const json = await response.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.transcripts || [];
}

// ─── Get already-scored meeting IDs ──────────────────────────────
async function getScoredMeetingIds() {
  const result = await pool.query("SELECT meeting_id FROM scorecards");
  return new Set(result.rows.map((r) => r.meeting_id));
}

// ─── Scoring prompt ──────────────────────────────────────────────
// Uses shared scoring-prompts.js (single source of truth).
// The buildScoringPrompt() function is imported at the top of this file.

// ─── Score via OpenClaw ──────────────────────────────────────────
function scoreViaOpenClaw(promptFilePath, sessionId) {
  const escapedPath = promptFilePath.replace(/'/g, "'\\''");
  const cmd = `openclaw agent -m "$(cat '${escapedPath}')" --json --session-id "${sessionId}" --timeout 300 2>/dev/null`;
  const rawResult = execSync(cmd, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 360000,
    env: { ...process.env, NODE_OPTIONS: "" },
  }).toString();

  // OpenClaw may print a "Doctor" banner to stdout before the JSON.
  // Strip everything before the first '{' to get clean JSON.
  const firstBrace = rawResult.indexOf("{");
  const lastBrace = rawResult.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("No JSON found in OpenClaw output");
  }
  const jsonStr = rawResult.substring(firstBrace, lastBrace + 1);

  // Parse the OpenClaw response wrapper
  const openclawResponse = JSON.parse(jsonStr);

  // Extract the actual scorecard text from the response payload
  const text =
    openclawResponse?.result?.payloads?.[0]?.text ||
    openclawResponse.text ||
    openclawResponse.content ||
    openclawResponse.message ||
    jsonStr;

  // Clean the scorecard text — may have markdown fences or extra prose
  let cleaned = text.trim();
  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) cleaned = match[1];
  }
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  const scorecard = JSON.parse(cleaned);
  if (typeof scorecard.score !== "number" || !scorecard.rag) {
    throw new Error("OpenClaw response missing required fields");
  }

  // Ensure close object always exists — model sometimes omits it
  if (!scorecard.close) {
    scorecard.close = {
      style: "none",
      styleName: "No Close Detected",
      setup: { score: 0, status: "missing", label: "No setup detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      bridge: { score: 0, status: "missing", label: "No bridge detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      ask: { score: 0, status: "missing", label: "No ask detected", feedback: "No close execution was detected in this call.", timestamps: [] },
    };
  }

  return scorecard;
}

// ─── Process one call ────────────────────────────────────────────
async function processOne(meetingId, label) {
  const start = Date.now();
  console.log(`${label} Fetching transcript ${meetingId}...`);

  const transcript = await fetchTranscript(meetingId);
  console.log(`${label} Got: "${transcript.title}" (${transcript.repName}, ${transcript.durationMinutes}m)`);

  if (transcript.durationMinutes && transcript.durationMinutes < MIN_DURATION_MINUTES) {
    console.log(`${label} Skipped — ${transcript.durationMinutes}m is under ${MIN_DURATION_MINUTES}m minimum (likely no-show)`);
    return { meetingId, skipped: true, reason: "too short" };
  }

  if (transcript.speakerCount < 2) {
    console.log(`${label} Skipped — only ${transcript.speakerCount} speaker(s) detected (prospect never joined)`);
    return { meetingId, skipped: true, reason: "no-show" };
  }

  const prompt = buildScoringPrompt(
    transcript.transcriptText,
    transcript.repName,
    transcript.companyName,
    transcript.durationMinutes
  );
  const promptFile = path.join(TMP_DIR, `${meetingId}.txt`);
  writeFileSync(promptFile, prompt);

  console.log(`${label} Scoring via OpenClaw...`);
  const sessionId = `killer-calls-poll-${meetingId}`;
  const scorecard = scoreViaOpenClaw(promptFile, sessionId);
  console.log(`${label} Score: ${scorecard.score}/100 (${scorecard.rag})`);

  // Extract prospect email from participants
  // Fireflies returns participants as an array, but the first element is often
  // a comma-concatenated string of ALL participant emails.
  // We need to split each element by comma, flatten, then filter.
  const allParticipantEmails = (transcript.participants || [])
    .flatMap((e) => e.split(",").map((s) => s.trim().toLowerCase()))
    .filter((e) => e.includes("@"));
  const prospectEmail = allParticipantEmails.find((e) => !AE_EMAIL_SET.has(e)) || null;

  // Detect followup
  let callType = "discovery";
  if (prospectEmail) {
    const priorByEmail = await pool.query(
      "SELECT id FROM scorecards WHERE prospect_email = $1 AND rep_name = $2 LIMIT 1",
      [prospectEmail, transcript.repName]
    );
    if (priorByEmail.rows.length > 0) callType = "followup";
  }
  if (callType === "discovery") {
    const priorByCompany = await pool.query(
      "SELECT id FROM scorecards WHERE company_name = $1 AND rep_name = $2 LIMIT 1",
      [transcript.companyName, transcript.repName]
    );
    if (priorByCompany.rows.length > 0) callType = "followup";
  }
  if (callType === "discovery" && FOLLOWUP_TITLE_PATTERNS.test(transcript.title || "")) {
    callType = "followup";
  }
  if (callType === "followup") {
    console.log(`${label} Detected as FOLLOW-UP call`);
  }

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId,
    title: transcript.title,
    callType,
    prospectEmail,
    teamId: "1f7fb17c-3581-47a0-ba89-d196f96944cd", // SalesCloser AI team
  };
  const scorecardId = await saveScorecard(scorecard, meta);

  // Look up matching Pipedrive deal after scoring
  const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;
  if (PIPEDRIVE_API_KEY && prospectEmail) {
    try {
      // Search for person by prospect email, then get their deals
      const pdPersonResp = await fetch(
        `https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(prospectEmail)}&limit=3`,
        { headers: { "X-Api-Token": PIPEDRIVE_API_KEY } }
      );
      const pdPersonData = await pdPersonResp.json();
      if (pdPersonData.success && pdPersonData.data?.items?.[0]?.item) {
        const personId = pdPersonData.data.items[0].item.id;
        const pdDealsResp = await fetch(
          `https://api.pipedrive.com/v1/persons/${personId}/deals`,
          { headers: { "X-Api-Token": PIPEDRIVE_API_KEY } }
        );
        const pdDealsData = await pdDealsResp.json();
        if (pdDealsData.success && pdDealsData.data?.length > 0) {
          const deals = pdDealsData.data.sort((a, b) => {
            if (a.status === 'open' && b.status !== 'open') return -1;
            if (a.status !== 'open' && b.status === 'open') return 1;
            return 0;
          });
          const deal = deals[0];
          let stageName = String(deal.stage_id);
          try {
            const stageResp = await fetch(
              `https://api.pipedrive.com/v1/stages/${deal.stage_id}`,
              { headers: { "X-Api-Token": PIPEDRIVE_API_KEY } }
            );
            const stageData = await stageResp.json();
            if (stageData.success && stageData.data) stageName = stageData.data.name;
          } catch (e) {}
          console.log(`${label} Found Pipedrive deal #${deal.id} (${deal.title}) [${stageName}]`);
          await pool.query(
            `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
            [String(deal.id), stageName, deal.value || null, scorecardId]
          );
        } else {
          console.log(`${label} No Pipedrive deals for person #${personId}`);
        }
      } else {
        console.log(`${label} No matching Pipedrive person for ${prospectEmail}`);
      }
    } catch (err) {
      console.error(`${label} Pipedrive lookup error: ${err.message}`);
    }
  }

  // Post to Slack
  try {
    const reviewResult = await postDemoReview(scorecard, meta, scorecardId);
    const killerResult = scorecard.score >= 80 ? await postKillerCall(scorecard, meta, scorecardId) : null;
    await updateSlackTs(scorecardId, {
      reviewTs: reviewResult?.ts || null,
      killerTs: killerResult?.ts || null,
    });
    if (reviewResult) console.log(`${label} Posted to Slack #demo-reviews`);
  } catch (err) {
    console.error(`${label} Slack error: ${err.message}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${label} ✅ Saved ${scorecardId} in ${elapsed}s`);
  return { meetingId, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
}

// ─── Main poll ───────────────────────────────────────────────────
// ─── Process pending scores from DB ──────────────────────────────
// Picks up calls that were enqueued by cloud deployments (Railway/Vercel)
// using SCORING_BACKEND=deferred and scores them via OpenClaw.

async function processPendingScores() {
  const pending = await pool.query(
    "SELECT * FROM pending_scores WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5"
  );

  if (pending.rows.length === 0) return 0;

  console.log(`  Found ${pending.rows.length} pending score(s) from cloud pipeline`);

  for (const row of pending.rows) {
    try {
      await pool.query(
        "UPDATE pending_scores SET status = 'processing', updated_at = NOW() WHERE id = $1",
        [row.id]
      );

      const prompt = row.user_prompt;
      const systemPrompt = row.system_prompt;
      const fullPrompt = systemPrompt
        ? systemPrompt + "  Now score the following transcript as instructed:  " + prompt
        : prompt;

      const fs = require("fs");
      const os = require("os");
      const tmpFile = `${os.tmpdir()}/killer-calls-pending-${row.meeting_id}.txt`;
      fs.writeFileSync(tmpFile, fullPrompt);
      const sessionId = `killer-calls-pending-${row.meeting_id}`;

      console.log(`  Scoring pending: ${row.meeting_id} (${row.rep_name})`);
      const scorecard = scoreViaOpenClaw(tmpFile, sessionId);
      console.log(`  Score: ${scorecard.score}/100 (${scorecard.rag})`);

      // Save the scorecard
      const meta = {
        repName: row.rep_name,
        companyName: row.company_name,
        date: new Date().toISOString(),
        durationMinutes: row.duration_minutes,
        meetingId: row.meeting_id,
        callType: "discovery",
        teamId: "1f7fb17c-3581-47a0-ba89-d196f96944cd", // SalesCloser AI team
      };
      const scorecardId = await saveScorecard(scorecard, meta);

      // Post to Slack
      try {
        const reviewResult = await postDemoReview(scorecard, meta, scorecardId);
        const killerResult = scorecard.score >= 80 ? await postKillerCall(scorecard, meta, scorecardId) : null;
        await updateSlackTs(scorecardId, {
          reviewTs: reviewResult?.ts || null,
          killerTs: killerResult?.ts || null,
        });
      } catch (err) {
        console.error(`  Slack error for pending ${row.meeting_id}: ${err.message}`);
      }

      // Mark as completed
      await pool.query(
        "UPDATE pending_scores SET status = 'completed', updated_at = NOW() WHERE id = $1",
        [row.id]
      );

      try { fs.unlinkSync(tmpFile); } catch (e) {}
      console.log(`  Saved pending score ${scorecardId}`);
    } catch (err) {
      console.error(`  FAILED pending ${row.meeting_id}: ${err.message}`);
      await pool.query(
        "UPDATE pending_scores SET status = 'failed', updated_at = NOW() WHERE id = $1",
        [row.id]
      );
    }
  }

  return pending.rows.length;
}

async function poll() {
  // Process any pending scores from cloud pipeline first
  const pendingCount = await processPendingScores();
  if (pendingCount > 0) console.log(`  Processed ${pendingCount} pending score(s)`);

  const ts = new Date().toLocaleString();
  console.log(`\n[${ts}] Polling Fireflies for new calls...`);

  // 1. Get already-scored meeting IDs + previously skipped
  const scored = RESCORE ? new Set() : await getScoredMeetingIds();
  const skipped = RESCORE ? new Set() : loadSkippedIds();
  if (RESCORE) console.log(`  --rescore mode: re-scoring ALL recent calls`);
  else console.log(`  ${scored.size} scored in DB, ${skipped.size} previously skipped`);

  // 2. Fetch recent transcripts for each AE
  const newMeetings = [];
  for (const email of AE_EMAILS) {
    try {
      const transcripts = await fetchRecentByOrganizer(email);
      for (const t of transcripts) {
        if (!scored.has(t.id) && !skipped.has(t.id)) {
          newMeetings.push({ id: t.id, title: t.title, email });
        }
      }
    } catch (err) {
      console.error(`  Error fetching for ${email}: ${err.message}`);
    }
  }

  if (newMeetings.length === 0) {
    console.log("  No new calls found. All up to date.");
    await pool.end();
    return;
  }

  // Cap to 2 calls per run to stay within cron time budget (~300s per call)
  const MAX_PER_RUN = 5;
  const toScore = newMeetings.slice(0, MAX_PER_RUN);
  if (newMeetings.length > MAX_PER_RUN) {
    console.log(`  Found ${newMeetings.length} new call(s) — processing ${MAX_PER_RUN} this run, rest next cycle.`);
  } else {
    console.log(`  Found ${toScore.length} new call(s) to score:\n`);
  }
  toScore.forEach((m, i) => console.log(`    ${i + 1}. ${m.title} (${m.email})`));
  console.log();

  mkdirSync(TMP_DIR, { recursive: true });

  // 3. Score each new call
  const results = [];
  let newSkips = 0;
  for (let i = 0; i < toScore.length; i++) {
    const label = `[${i + 1}/${newMeetings.length}]`;
    try {
      const r = await processOne(toScore[i].id, label);
      results.push(r);
      if (r.skipped) {
        skipped.add(r.meetingId);
        newSkips++;
      }
    } catch (err) {
      console.error(`${label} ❌ FAILED ${toScore[i].id}: ${err.message}`);
    }
  }

  // Sync skip file with DB as source of truth
  await syncSkipFileFromDb();

  // 4. Summary
  const scored_results = results.filter((r) => !r.skipped);
  const skipped_results = results.filter((r) => r.skipped);
  console.log(`\n  Done: ${scored_results.length} scored, ${skipped_results.length} skipped`);
  scored_results.forEach((r) => {
    const icon = r.rag === "green" ? "🟢" : r.rag === "yellow" ? "🟡" : "🔴";
    console.log(`  ${icon} ${String(r.score).padStart(3)}/100  ${r.rep}`);
  });

  await pool.end();
}

poll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
