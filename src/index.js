require("dotenv").config();

const express = require("express");
const { fetchTranscript } = require("./fireflies-client");
const { scoreTranscript, FOLLOWUP_SYSTEM_PROMPT, buildFollowupScoringPrompt } = require("./scoring-engine");
const { postDemoReview, postKillerCall } = require("./slack-formatter");
const { saveScorecard, updateSlackTs, pool } = require("./db");
const { CONFIG } = require("./constants");

// ─── Followup detection ──────────────────────────────────────────

const AE_EMAIL_SET = new Set([
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "zachary.o@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "marysol.o@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
]);

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s*call|second\s*call|check[\s-]?in/i;

function extractProspectEmail(participants) {
  if (!participants || !Array.isArray(participants)) return null;
  for (const p of participants) {
    const email = (typeof p === "string" ? p : p?.email || "").toLowerCase().trim();
    if (email && email.includes("@") && !AE_EMAIL_SET.has(email)) {
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

const app = express();
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "killer-calls-mvp", version: "1.0.0" });
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
// The full flow: fetch → score → post.

async function processDemo(meetingId) {
  const startTime = Date.now();

  // Step 1: Fetch transcript from Fireflies
  console.log(`\n[1/4] Fetching transcript from Fireflies...`);
  const transcript = await fetchTranscript(meetingId);
  console.log(`[1/4] Got transcript: "${transcript.title}" (${transcript.durationMinutes} min, ${transcript.transcriptText.length} chars)`);

  // Extract prospect email
  const prospectEmail = extractProspectEmail(transcript.participants);
  if (prospectEmail) {
    console.log(`[1/4] Prospect email: ${prospectEmail}`);
  }

  // Detect followup
  const { isFollowup, priorCallContext } = await detectFollowup(
    transcript.repName, transcript.companyName, prospectEmail, transcript.title
  );
  const callType = isFollowup ? "followup" : "discovery";
  if (isFollowup) {
    console.log(`[1/4] Detected as FOLLOW-UP call${priorCallContext ? " (prior call found)" : " (title match)"}`);
  }

  // Step 2: Score with Claude
  console.log(`\n[2/4] Scoring with Claude (${callType})...`);
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
  }

  const scorecard = await scoreTranscript(scoringArgs);
  console.log(`[2/4] Score: ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`[2/4] Verdict: ${scorecard.verdict}`);

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId,
    callType,
    prospectEmail
  };

  // Step 3: Save to database
  console.log(`\n[3/4] Saving to database...`);
  const scorecardId = await saveScorecard(scorecard, meta);
  console.log(`[3/4] Saved scorecard: ${scorecardId}`);

  // Step 4: Post to Slack
  console.log(`\n[4/4] Posting to Slack...`);

  // Always post to #demo-reviews
  const reviewResult = await postDemoReview(scorecard, meta, scorecardId);

  // Post to #killer-calls if score >= 80
  let killerResult = null;
  if (scorecard.score >= 80) {
    killerResult = await postKillerCall(scorecard, meta, scorecardId);
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
  console.log(`\n🚀 Killer Calls MVP running on port ${CONFIG.port}`);
  console.log(`   Webhook URL: POST http://localhost:${CONFIG.port}/webhook/fireflies`);
  console.log(`   Health check: GET http://localhost:${CONFIG.port}/`);
  console.log(`   Model: ${CONFIG.claudeModel}`);
  console.log(`   Slack #demo-reviews: ${process.env.SLACK_CHANNEL_REVIEWS || "(not set)"}`);
  console.log(`   Slack #killer-calls: ${process.env.SLACK_CHANNEL_KILLER || "(not set)"}\n`);
});
