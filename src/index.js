require("dotenv").config();

const express = require("express");
const { fetchTranscript } = require("./fireflies-client");
const { scoreTranscript } = require("./scoring-engine");
const { postDemoReview, postKillerCall } = require("./slack-formatter");
const { saveScorecard, updateSlackTs } = require("./db");
const { CONFIG } = require("./constants");

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
  console.log(`\n[1/3] Fetching transcript from Fireflies...`);
  const transcript = await fetchTranscript(meetingId);
  console.log(`[1/3] Got transcript: "${transcript.title}" (${transcript.durationMinutes} min, ${transcript.transcriptText.length} chars)`);

  // Step 2: Score with Claude
  console.log(`\n[2/3] Scoring with Claude...`);
  const scorecard = await scoreTranscript({
    transcriptText: transcript.transcriptText,
    repName: transcript.repName,
    companyName: transcript.companyName,
    durationMinutes: transcript.durationMinutes
  });
  console.log(`[2/3] Score: ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`[2/3] Verdict: ${scorecard.verdict}`);

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId
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
