require("dotenv").config();

const express = require("express");
const { fetchTranscript } = require("./fireflies-client");
const { scoreTranscript, FOLLOWUP_SYSTEM_PROMPT, buildFollowupScoringPrompt, buildScoringPromptWithWeights } = require("./scoring-engine");
const { postDemoReview, postKillerCall } = require("./slack-formatter");
const { saveScorecard, updateSlackTs, extractPlaybookExamples, pool } = require("./db");
const { CONFIG } = require("./constants");

// ─── Followup detection ──────────────────────────────────────────

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s*call|second\s*call|check[\s-]?in/i;

function extractProspectEmail(participants, aeEmails) {
  if (!participants || !Array.isArray(participants)) return null;
  for (const p of participants) {
    const email = (typeof p === "string" ? p : p?.email || "").toLowerCase().trim();
    if (email && email.includes("@") && !aeEmails.has(email)) {
      return email;
    }
  }
  return null;
}

async function detectFollowup(repName, companyName, prospectEmail, title) {
  // 1. Check by prospect email (most reliable)
  if (prospectEmail) {
    const priorByEmail = await pool.query(
      `SELECT id, score, rag, verdict, company_name,
              spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
              bant_b, bant_a, bant_n, bant_t,
              scorecard_json
       FROM scorecards
       WHERE prospect_email = $1 AND rep_name = $2
       ORDER BY created_at DESC LIMIT 1`,
      [prospectEmail, repName]
    );
    if (priorByEmail.rows.length > 0) {
      return { isFollowup: true, priorCallContext: buildPriorContext(priorByEmail.rows[0]) };
    }
  }

  // 2. Check by company name
  const priorByCompany = await pool.query(
    `SELECT id, score, rag, verdict, company_name,
            spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
            bant_b, bant_a, bant_n, bant_t,
            scorecard_json
     FROM scorecards
     WHERE company_name = $1 AND rep_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [companyName, repName]
  );
  if (priorByCompany.rows.length > 0) {
    return { isFollowup: true, priorCallContext: buildPriorContext(priorByCompany.rows[0]) };
  }

  // 3. Check by title pattern
  if (FOLLOWUP_TITLE_PATTERNS.test(title || "")) {
    return { isFollowup: true, priorCallContext: null };
  }

  return { isFollowup: false, priorCallContext: null };
}

function buildPriorContext(row) {
  let sc = null;
  try {
    sc = typeof row.scorecard_json === "string" ? JSON.parse(row.scorecard_json) : row.scorecard_json;
  } catch {}
  const lines = [];
  lines.push(`Prior call score: ${row.score}/100 (${row.rag})`);
  lines.push(`Verdict: ${row.verdict}`);

  const spicedItems = ["s", "p", "i", "c", "e"].map((k) => {
    const status = row[`spiced_${k}`] || "missing";
    const word = k === "s" ? "Situation" : k === "p" ? "Pain" : k === "i" ? "Impact" : k === "c" ? "Critical Event" : "Decision";
    return `${word}: ${status}`;
  });
  lines.push(`SPICED: ${spicedItems.join(", ")}`);

  const bantItems = ["b", "a", "n", "t"].map((k) => {
    const status = row[`bant_${k}`] || "missing";
    const word = k === "b" ? "Budget" : k === "a" ? "Authority" : k === "n" ? "Need" : "Timeline";
    return `${word}: ${status}`;
  });
  lines.push(`BANT: ${bantItems.join(", ")}`);

  if (sc?.fixes?.length > 0) {
    lines.push(`Top fixes from prior call:\n${sc.fixes.map((f) => `  - ${f}`).join("\n")}`);
  }

  return lines.join("\n");
}

// ─── Team routing ────────────────────────────────────────────────
// Look up which team a call belongs to based on organizer email

async function resolveTeam(organizerEmail) {
  // Query all team rosters from settings
  const result = await pool.query(
    `SELECT s.team_id, s.value as roster
     FROM settings s
     WHERE s.key = 'ae_roster'`
  );

  for (const row of result.rows) {
    const roster = typeof row.roster === "string" ? JSON.parse(row.roster) : row.roster;
    if (!Array.isArray(roster)) continue;
    for (const ae of roster) {
      if (ae.email && ae.email.toLowerCase() === organizerEmail.toLowerCase()) {
        if (ae.active === false) {
          console.log(`[team] AE ${ae.name} is inactive — skipping scoring`);
          return null;
        }
        return { teamId: row.team_id, aeEntry: ae };
      }
    }
  }

  return null;
}

// Build a Set of AE emails for a team roster
function buildAeEmailSet(roster) {
  const set = new Set();
  if (Array.isArray(roster)) {
    for (const ae of roster) {
      if (ae.email) set.add(ae.email.toLowerCase());
    }
  }
  return set;
}

// Get team-specific settings
async function getTeamSettings(teamId) {
  const result = await pool.query(
    `SELECT key, value FROM settings WHERE team_id = $1`,
    [teamId]
  );
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  }
  return settings;
}

// ─── Dedup guard ─────────────────────────────────────────────
// Prevent double-processing when Fireflies sends duplicate webhooks
const inFlightMeetings = new Set();

const app = express();
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "killer-calls-mvp", version: "2.0.0" });
});

// ─── Fireflies Webhook ──────────────────────────────────────────
// Receives a POST when a new transcript is ready.
// Immediately returns 200, then processes async.

app.post("/webhook/fireflies", (req, res) => {
  const meetingId = req.body.meetingId || req.body.meeting_id || req.body.data?.meetingId;

  if (!meetingId) {
    console.warn("[webhook] Received webhook with no meetingId:", JSON.stringify(req.body).substring(0, 200));
    return res.status(400).json({ error: "meetingId is required" });
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[webhook] Received: meetingId=${meetingId}`);
  console.log(`[webhook] Time: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);

  // Acknowledge immediately — don't block Fireflies
  res.status(200).json({ received: true, meetingId });

  // Process async
  processDemo(meetingId).catch((err) => {
    console.error(`[pipeline] FAILED for meetingId=${meetingId}:`, err.message);
  });
});

// ─── Pipeline ────────────────────────────────────────────────────
// The full flow: fetch → route team → score → post.

async function processDemo(meetingId) {
  // Dedup: skip if already processing or already scored
  if (inFlightMeetings.has(meetingId)) {
    console.log(`[dedup] Already processing meetingId=${meetingId} — skipping duplicate webhook`);
    return;
  }
  inFlightMeetings.add(meetingId);

  try {
    // Check if already scored in DB (survives restarts)
    const existing = await pool.query(
      `SELECT id FROM scorecards WHERE meeting_id = $1`,
      [meetingId]
    );
    if (existing.rows.length > 0) {
      console.log(`[dedup] meetingId=${meetingId} already scored (${existing.rows[0].id}) — skipping`);
      return;
    }

    await _processDemo(meetingId);
  } finally {
    inFlightMeetings.delete(meetingId);
  }
}

async function _processDemo(meetingId) {
  const startTime = Date.now();

  // Claim this meeting so no other pipeline processes it concurrently
  const claim = await pool.query(
    `INSERT INTO skipped_meetings (meeting_id, reason) VALUES ($1, 'processing')
     ON CONFLICT DO NOTHING RETURNING meeting_id`,
    [meetingId]
  );
  if (claim.rows.length === 0) {
    console.log(`[dedup] meetingId=${meetingId} already claimed by another pipeline — skipping`);
    return;
  }

  // Step 1: Fetch transcript from Fireflies
  console.log(`\n[1/5] Fetching transcript from Fireflies...`);
  const transcript = await fetchTranscript(meetingId);
  console.log(`[1/5] Got transcript: "${transcript.title}" (${transcript.durationMinutes} min, ${transcript.transcriptText.length} chars)`);

  // Step 2: Resolve team from organizer email
  console.log(`\n[2/5] Resolving team...`);
  const organizerEmail = transcript.participants?.find((p) => {
    const email = (typeof p === "string" ? p : p?.email || "").toLowerCase();
    return email.includes("@");
  }) || "";
  const orgEmail = (typeof organizerEmail === "string" ? organizerEmail : organizerEmail?.email || "").toLowerCase();

  const teamMatch = await resolveTeam(orgEmail);
  if (!teamMatch) {
    console.warn(`[2/5] No team found for organizer email: ${orgEmail} — skipping`);
    return;
  }

  const { teamId, aeEntry } = teamMatch;
  const teamSettings = await getTeamSettings(teamId);
  const aeEmails = buildAeEmailSet(teamSettings.ae_roster || []);

  console.log(`[2/5] Team: ${teamId}, AE: ${aeEntry.name}`);

  // Extract prospect email
  const prospectEmail = extractProspectEmail(transcript.participants, aeEmails);
  if (prospectEmail) {
    console.log(`[2/5] Prospect email: ${prospectEmail}`);
  }

  // Check excluded patterns
  const excludedPatterns = teamSettings.excluded_patterns || [];
  if (Array.isArray(excludedPatterns) && excludedPatterns.length > 0) {
    for (const pattern of excludedPatterns) {
      try {
        if (new RegExp(pattern, "i").test(transcript.title || "")) {
          console.log(`[2/5] Skipping — title "${transcript.title}" matches excluded pattern "${pattern}"`);
          return;
        }
      } catch {}
    }
  }

  // Detect followup
  const { isFollowup, priorCallContext } = await detectFollowup(
    transcript.repName, transcript.companyName, prospectEmail, transcript.title
  );
  const callType = isFollowup ? "followup" : "discovery";
  if (isFollowup) {
    console.log(`[2/5] Detected as FOLLOW-UP call${priorCallContext ? " (prior call found)" : " (title match)"}`);
  }

  // Step 3: Score with Claude
  console.log(`\n[3/5] Scoring with Claude (${callType})...`);
  const scoringArgs = {
    transcriptText: transcript.transcriptText,
    repName: transcript.repName,
    companyName: transcript.companyName,
    durationMinutes: transcript.durationMinutes
  };

  if (isFollowup) {
    scoringArgs.systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
    scoringArgs.userPrompt = buildFollowupScoringPrompt(
      transcript.transcriptText, transcript.repName, transcript.companyName,
      transcript.durationMinutes, priorCallContext
    );
  } else if (teamSettings.scoring_weights) {
    scoringArgs.userPrompt = buildScoringPromptWithWeights(
      transcript.transcriptText, transcript.repName, transcript.companyName,
      transcript.durationMinutes, teamSettings.scoring_weights
    );
  }

  const scorecard = await scoreTranscript(scoringArgs);
  console.log(`[3/5] Score: ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`[3/5] Verdict: ${scorecard.verdict}`);

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId,
    callType,
    prospectEmail,
    teamId
  };

  // Step 4: Save to database (and release the processing claim)
  console.log(`\n[4/5] Saving to database...`);
  const scorecardId = await saveScorecard(scorecard, meta);
  await pool.query(`DELETE FROM skipped_meetings WHERE meeting_id = $1`, [meetingId]);
  console.log(`[4/5] Saved scorecard: ${scorecardId}`);

  // Extract playbook examples
  try {
    await extractPlaybookExamples(scorecard, meta, scorecardId, teamId);
  } catch (err) {
    console.error(`[playbook] Extraction failed: ${err.message}`);
  }

  // Step 5: Post to Slack (using team-specific channel IDs)
  console.log(`\n[5/5] Posting to Slack...`);

  const slackReviewsChannel = teamSettings.slack_channel_reviews || process.env.SLACK_CHANNEL_REVIEWS;
  const slackKillerChannel = teamSettings.slack_channel_killer || process.env.SLACK_CHANNEL_KILLER;
  const appUrl = teamSettings.app_url || process.env.APP_URL;
  const roster = teamSettings.ae_roster || [];
  const slackBotToken = teamSettings.slack_bot_token || undefined;
  const killerThreshold = teamSettings.killer_threshold || 80;

  // Always post to #demo-reviews
  const reviewResult = await postDemoReview(scorecard, meta, scorecardId, {
    channelId: slackReviewsChannel,
    appUrl,
    roster,
    slackBotToken,
  });

  // Post to #killer-calls if score >= threshold
  let killerResult = null;
  if (scorecard.score >= killerThreshold) {
    killerResult = await postKillerCall(scorecard, meta, scorecardId, {
      channelId: slackKillerChannel,
      appUrl,
      roster,
      slackBotToken,
      killerThreshold,
    });
  }

  // Update scorecard with Slack message timestamps
  await updateSlackTs(scorecardId, {
    reviewTs: reviewResult?.ts || null,
    killerTs: killerResult?.ts || null
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Pipeline complete in ${elapsed}s — ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`${"─".repeat(60)}\n`);
}

// ─── Start Server ────────────────────────────────────────────────

function validateEnv() {
  const required = ["ANTHROPIC_API_KEY", "FIREFLIES_API_KEY", "DATABASE_URL"];
  const optional = ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_REVIEWS", "SLACK_CHANNEL_KILLER"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(", ")}`);
    console.error("   Copy .env.example to .env and fill in your keys.\n");
    process.exit(1);
  }

  const missingOptional = optional.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn(`⚠️  Missing optional env vars (Slack won't post): ${missingOptional.join(", ")}`);
  }
}

validateEnv();

app.listen(CONFIG.port, () => {
  console.log(`\n🚀 Killer Calls running on port ${CONFIG.port} (multi-team)`);
  console.log(`   Webhook URL: POST http://localhost:${CONFIG.port}/webhook/fireflies`);
  console.log(`   Health check: GET http://localhost:${CONFIG.port}/`);
  console.log(`   Model: ${CONFIG.claudeModel}\n`);
});
