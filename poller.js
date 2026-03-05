#!/usr/bin/env node
require("dotenv").config();

const { execSync } = require("child_process");
const { saveScorecard, updateSlackTs, pool } = require("./src/db");
const { fetchTranscript } = require("./src/fireflies-client");
const { postDemoReview, postKillerCall } = require("./src/slack-formatter");
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("fs");
const path = require("path");
const { CONFIG } = require("./src/constants");

// ─── AE organizer emails ────────────────────────────────────────
const AE_EMAILS = [
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "zachary.o@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "marysol.o@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
];

const TMP_DIR = path.join(__dirname, ".tmp-transcripts");
const SKIP_FILE = path.join(__dirname, ".skipped-meetings.json");
const MIN_DURATION_MINUTES = 20;

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

function saveSkippedIds(skippedSet) {
  writeFileSync(SKIP_FILE, JSON.stringify([...skippedSet], null, 2));
}

// ─── Fetch recent transcripts from Fireflies ────────────────────
const RECENT_TRANSCRIPTS_QUERY = `
  query RecentTranscripts($organizerEmail: String) {
    transcripts(organizer_email: $organizerEmail, limit: 10) {
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

// ─── Scoring prompt (same as batch-import-openclaw.js) ───────────
function buildOpenClawPrompt(transcriptText, repName, companyName, durationMinutes) {
  return `You are an expert sales call analyst. Score this demo call against a strict 14-criterion rubric. Your output is ONLY valid JSON — no prose, no markdown fences.

REP: ${repName}
PROSPECT: ${companyName}
DURATION: ${durationMinutes || "unknown"} minutes

─── SCORING RUBRIC (100 points total) ───

PHASE 1 — PRE-CALL PREPARATION (6 pts)
1. Research & preparation (6 pts) - Green (5-6): Industry knowledge evident - Yellow (3-4): Surface-level - Red (0-2): No evidence

PHASE 2 — DISCOVERY (32 pts)
2. Agenda setting (7 pts) - Green (6-7): Clear agenda + prospect confirmed - Yellow (3-5): Stated but no buy-in - Red (0-2): No agenda
3. SPICED discovery (25 pts — 5 each): S=Situation, P=Pain, I=Impact, C=Critical Event, E=Decision

PHASE 3 — PRESENTATION (22 pts)
4. Smooth & professional (4 pts)
5. Talk ratio (6 pts) - Green: No AE monologue >90s, prospect spoke ~40%
6. Personalization (8 pts) - Green: Tied to prospect pain - Red: Generic feature dump
7. Tie-downs (4 pts) - Green: Regular value checks

PHASE 4 — PRICING & OBJECTION HANDLING (28 pts)
8. Value summary before price (8 pts)
9. Simple pricing (6 pts) - One option, then silence
10. No premature discount (2 pts) - Auto red flag if discount before ECIR
11. ECIR objection handling (12 pts): Empathize→Clarify→Isolate→Respond

PHASE 5 — CLOSE & NEXT STEPS (12 pts)
12. Close execution (10 pts total — 4 + 3 + 3)
    There are THREE valid closing styles. Identify which style the AE used, then score Setup (4 pts), Bridge (3 pts), Ask (3 pts):
    STYLE A — CONSULTATIVE CLOSE: Setup=Summarize Value, Bridge=Surface Blockers, Ask=Ask for Commitment
    STYLE B — ASSUMPTIVE CLOSE: Setup=Read Buying Signals, Bridge=Smooth Transition, Ask=Lock Specific Action
    STYLE C — URGENCY CLOSE: Setup=Tie to Critical Event, Bridge=Build the Timeline, Ask=Propose the Plan
    If no close attempted, score 0/10 and set style to "none".
13. Scheduled follow-up (2 pts) - Green: Specific date/time confirmed

BANT QUALIFICATION (evaluated separately — does NOT affect the 100-point score)
Evaluate each BANT element independently. Score 0-5 per element.
- B — Budget (5 pts): Did the AE establish whether the prospect has budget allocated or can secure it?
  Strong (4-5): Budget explicitly discussed, amount or range confirmed
  Partial (2-3): Budget mentioned but not confirmed
  Missing (0-1): No budget discussion
- A — Authority (5 pts): Did the AE confirm who the decision-maker is?
  Strong (4-5): Decision-maker identified, role clear
  Partial (2-3): Asked about decision process but didn't pin down authority
  Missing (0-1): No discussion of buying decision
- N — Need (5 pts): Did the AE uncover a clear, urgent business need?
  Strong (4-5): Specific need articulated and tied to product
  Partial (2-3): General need discussed but not specific
  Missing (0-1): No clear need established
- T — Timeline (5 pts): Did the AE establish a concrete decision timeline?
  Strong (4-5): Specific date, event, or deadline
  Partial (2-3): Vague timeframe without commitment
  Missing (0-1): No timeline discussed

BONUS FLAGS: Enthusiasm, Unprofessional language, Premature disqualification

─── OUTPUT FORMAT ───
Return ONLY this JSON:
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 6, "criteria": { "research": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<2-3 sentences>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 32, "criteria": { "agenda": { "score": <n>, "maxPoints": 7, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "spiced": { "score": <n>, "maxPoints": 25 } } },
    "presentation": { "score": <n>, "maxPoints": 22, "criteria": { "smooth": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "talkRatio": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "personalization": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "tieDowns": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 28, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "simplePricing": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "noDiscount": { "score": <n>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ecir": { "score": <n>, "maxPoints": 12, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [{ "topic": "<...>", "timestamp": "MM:SS", "empathize": true|false, "clarify": true|false, "isolate": true|false, "respond": true|false }] } } },
    "closing": { "score": <n>, "maxPoints": 12, "criteria": { "closeExecution": { "score": <n>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<coaching feedback on the overall close attempt>", "timestamps": ["MM:SS"] }, "followUp": { "score": <n>, "maxPoints": 2, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
  },
  "spiced": {
    "s": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "p": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "i": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "c": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "e": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }
  },
  "bant": {
    "b": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "a": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "n": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "t": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }
  },
  "close": {
    "style": "consultative"|"assumptive"|"urgency"|"none",
    "styleName": "<e.g. 'Consultative Close'>",
    "setup": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<step name>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "bridge": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<step name>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "ask": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<step name>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
  },
  "closingTips": [
    "<Specific, actionable closing tip #1 tailored to this call>",
    "<Closing tip #2 referencing a specific moment where a different approach would improve the close>",
    "<Closing tip #3 with a concrete technique or phrase the rep can use>"
  ],
  "wins": ["<win #1 with timestamp>", "<win #2>", "<win #3>"],
  "fixes": ["<fix #1>", "<fix #2>"],
  "flags": {
    "enthusiasm": { "detected": true|false, "note": "<...>" },
    "unprofessionalLanguage": { "detected": true|false, "note": "<...>" },
    "prematureDisqualification": { "detected": true|false, "note": "<...>" }
  },
  "quoteOfTheCall": { "text": "<exact quote>", "timestamp": "MM:SS", "context": "<why it matters>" }
}

─── TRANSCRIPT ───

${transcriptText}`;
}

// ─── Score via OpenClaw ──────────────────────────────────────────
function scoreViaOpenClaw(promptFilePath, sessionId) {
  const escapedPath = promptFilePath.replace(/'/g, "'\\''");
  const cmd = `openclaw agent -m "$(cat '${escapedPath}')" --json --session-id "${sessionId}" --timeout 180 2>/dev/null`;
  const rawResult = execSync(cmd, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 240000,
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

  const prompt = buildOpenClawPrompt(
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

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId,
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
    if (reviewResult) console.log(`${label} Posted to Slack #demo-reviews`);
  } catch (err) {
    console.error(`${label} Slack error: ${err.message}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`${label} ✅ Saved ${scorecardId} in ${elapsed}s`);
  return { meetingId, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
}

// ─── Main poll ───────────────────────────────────────────────────
async function poll() {
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

  console.log(`  Found ${newMeetings.length} new call(s) to score:\n`);
  newMeetings.forEach((m, i) => console.log(`    ${i + 1}. ${m.title} (${m.email})`));
  console.log();

  mkdirSync(TMP_DIR, { recursive: true });

  // 3. Score each new call
  const results = [];
  let newSkips = 0;
  for (let i = 0; i < newMeetings.length; i++) {
    const label = `[${i + 1}/${newMeetings.length}]`;
    try {
      const r = await processOne(newMeetings[i].id, label);
      results.push(r);
      if (r.skipped) {
        skipped.add(r.meetingId);
        newSkips++;
      }
    } catch (err) {
      console.error(`${label} ❌ FAILED ${newMeetings[i].id}: ${err.message}`);
    }
  }

  // Persist skipped IDs so they're excluded next cycle
  if (newSkips > 0) {
    saveSkippedIds(skipped);
    console.log(`  Saved ${newSkips} newly skipped meeting(s) to skip list`);
  }

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
