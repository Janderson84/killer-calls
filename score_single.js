#!/usr/bin/env node
// One-shot scorer for a single Fireflies meeting ID
require("dotenv").config();
const { saveScorecard, updateSlackTs, pool } = require("./src/db");
const { fetchTranscript } = require("./src/fireflies-client");
const { scoreTranscript } = require("./src/scoring-engine");
const { postDemoReview, postKillerCall } = require("./src/slack-formatter");

const MEETING_ID = process.argv[2];
if (!MEETING_ID) { console.error("Usage: node score_single.js <meetingId>"); process.exit(1); }

async function run() {
  const label = `[${MEETING_ID}]`;
  console.log(`${label} Fetching transcript...`);
  const transcript = await fetchTranscript(MEETING_ID);

  if (!transcript) { console.log(`${label} No transcript found`); await pool.end(); return; }
  console.log(`${label} ${transcript.title} — ${transcript.durationMinutes}m — ${transcript.repName}`);

  if (!transcript.transcriptText || transcript.transcriptText.trim().length < 100) {
    console.log(`${label} Transcript text empty or too short — cannot score`);
    await pool.end(); return;
  }

  console.log(`${label} Scoring...`);
  const scorecard = await scoreTranscript({
    transcriptText: transcript.transcriptText,
    repName: transcript.repName,
    companyName: transcript.companyName,
    durationMinutes: transcript.durationMinutes,
  });

  const icon = scorecard.rag === 'green' ? '🟢' : scorecard.rag === 'yellow' ? '🟡' : '🔴';
  console.log(`${label} Score: ${scorecard.score}/100 ${icon}`);

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId: MEETING_ID,
    title: transcript.title,
    callType: 'demo',
    prospectEmail: '',
    teamId: "1f7fb17c-3581-47a0-ba89-d196f96944cd",
  };

  const scorecardId = await saveScorecard(scorecard, meta);
  console.log(`${label} Saved: ${scorecardId}`);

  const reviewResult = await postDemoReview(scorecard, meta, scorecardId);
  const killerResult = scorecard.score >= 80 ? await postKillerCall(scorecard, meta, scorecardId) : null;
  await updateSlackTs(scorecardId, { reviewTs: reviewResult?.ts || null, killerTs: killerResult?.ts || null });

  if (reviewResult) console.log(`${label} Posted to #demo-reviews ✅`);
  else console.log(`${label} Slack post skipped/failed`);

  await pool.end();
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
