#!/usr/bin/env node
/**
 * Score a single Fireflies call by transcript ID.
 * Usage: node score-one.js <transcript_id> [--rescore]
 */
require("dotenv").config();

const { saveScorecard, updateSlackTs, pool } = require("./src/db");
const { fetchTranscript } = require("./src/fireflies-client");
const { postDemoReview, postKillerCall } = require("./src/slack-formatter");
const { readFileSync, writeFileSync, mkdirSync } = require("fs");
const path = require("path");

// Inline the needed pieces from poller.js
const { execSync } = require("child_process");
const { CONFIG } = require("./src/constants");

const AE_EMAILS = [
  "pedro.c@salescloser.ai", "edgar.a@salescloser.ai", "marc.b@salescloser.ai",
  "zachary.o@salescloser.ai", "alfred.d@salescloser.ai", "vanessa.f@salescloser.ai",
  "marysol.o@salescloser.ai", "gleidson.r@salescloser.ai", "david.m@salescloser.ai",
];
const AE_EMAIL_SET = new Set(AE_EMAILS.map(e => e.toLowerCase()));
const TMP_DIR = path.join(__dirname, ".tmp-transcripts");
const MIN_DURATION_MINUTES = 20;
const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s+call|second\s+call|check[\s-]?in/i;
const RESCORE = process.argv.includes("--rescore");

// Pull buildOpenClawPrompt + scoreViaOpenClaw from poller by re-requiring it indirectly
// Instead, just inline the processOne logic by importing the shared modules
// and re-using the prompt builder from poller

// Load the prompt builder and scorer from poller source
const pollerSrc = readFileSync(path.join(__dirname, "poller.js"), "utf8");
const promptFnMatch = pollerSrc.match(/function buildOpenClawPrompt[\s\S]+?^}/m);
const scoreFnMatch  = pollerSrc.match(/function scoreViaOpenClaw[\s\S]+?^}/m);

// Eval them into scope (safe — local file only)
eval(promptFnMatch[0]);
eval(scoreFnMatch[0]);

async function main() {
  const meetingId = process.argv[2];
  if (!meetingId) {
    console.error("Usage: node score-one.js <transcript_id> [--rescore]");
    process.exit(1);
  }

  console.log(`\n🎯 Scoring single call: ${meetingId}\n`);
  mkdirSync(TMP_DIR, { recursive: true });

  // Check if already scored
  if (!RESCORE) {
    const existing = await pool.query("SELECT id, score FROM scorecards WHERE meeting_id = $1", [meetingId]);
    if (existing.rows.length > 0) {
      console.log(`⚠️  Already scored (score: ${existing.rows[0].score}). Use --rescore to force re-score.`);
      await pool.end();
      return;
    }
  }

  const transcript = await fetchTranscript(meetingId);
  console.log(`📋 "${transcript.title}"`);
  console.log(`   Rep: ${transcript.repName} | Duration: ${transcript.durationMinutes}m | Speakers: ${transcript.speakerCount}`);

  if (transcript.durationMinutes < MIN_DURATION_MINUTES) {
    console.log(`⏭️  Skipped — ${transcript.durationMinutes}m is under ${MIN_DURATION_MINUTES}m minimum`);
    await pool.end();
    return;
  }
  if (transcript.speakerCount < 2) {
    console.log(`⏭️  Skipped — only ${transcript.speakerCount} speaker(s)`);
    await pool.end();
    return;
  }

  const prompt = buildOpenClawPrompt(
    transcript.transcriptText, transcript.repName,
    transcript.companyName, transcript.durationMinutes
  );
  const promptFile = path.join(TMP_DIR, `${meetingId}.txt`);
  writeFileSync(promptFile, prompt);

  console.log(`\n🤖 Scoring via OpenClaw...`);
  const sessionId = `killer-calls-poll-${meetingId}`;
  const scorecard = scoreViaOpenClaw(promptFile, sessionId);
  console.log(`\n✅ Score: ${scorecard.score}/100 (${scorecard.rag})`);

  // Detect followup
  const prospectEmail = (transcript.participants || [])
    .map(e => e.toLowerCase().trim())
    .find(e => e.includes("@") && !AE_EMAIL_SET.has(e)) || null;

  let callType = "discovery";
  if (prospectEmail) {
    const prior = await pool.query(
      "SELECT id FROM scorecards WHERE prospect_email = $1 AND rep_name = $2 LIMIT 1",
      [prospectEmail, transcript.repName]
    );
    if (prior.rows.length > 0) callType = "followup";
  }
  if (callType === "discovery") {
    const prior = await pool.query(
      "SELECT id FROM scorecards WHERE company_name = $1 AND rep_name = $2 LIMIT 1",
      [transcript.companyName, transcript.repName]
    );
    if (prior.rows.length > 0) callType = "followup";
  }
  if (FOLLOWUP_TITLE_PATTERNS.test(transcript.title || "")) callType = "followup";

  const meta = {
    meetingId,
    repName: transcript.repName,
    companyName: transcript.companyName,
    prospectEmail,
    durationMinutes: transcript.durationMinutes,
    callType,
    firefliesUrl: `https://app.fireflies.ai/view/${transcript.title.replace(/\s+/g, "-")}::${meetingId}`,
  };

  const saved = await saveScorecard(meta, scorecard);
  console.log(`💾 Saved to DB (id: ${saved.id})`);

  // Post to Slack
  const appUrl = process.env.APP_URL || "https://web-sage-pi-82.vercel.app";
  const scorecardUrl = `${appUrl}/calls/${saved.id}`;

  await postDemoReview(transcript.repName, transcript.companyName, scorecard, scorecardUrl, meta);
  console.log(`📣 Posted to #demo-reviews`);

  if (scorecard.score >= 80) {
    await postKillerCall(transcript.repName, transcript.companyName, scorecard, scorecardUrl, meta);
    console.log(`🏆 Posted to #killer-calls`);
  }

  await pool.end();
  console.log(`\n🔗 ${scorecardUrl}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
