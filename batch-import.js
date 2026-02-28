#!/usr/bin/env node
require("dotenv").config();

const { fetchTranscript } = require("./src/fireflies-client");
const { scoreTranscript } = require("./src/scoring-engine");
const { saveScorecard, pool } = require("./src/db");

// ─── 27 real demo calls — 3 per AE ─────────────────────────────
const MEETING_IDS = [
  // Pedro Cavagnari
  "01KHVYQPSJJXTNYYMM85ZAAEXV",
  "01KJ8F40MY1ATWS0BW7SNT8XSM",
  "01KHVYQPSKK1RVD9KXQWYY6KZK",
  // Marc James Beauchamp
  "01KJ8B09BSJR58AY4QS86078V2",
  "01KJ604GXC9ZZP74WDCM53E09P",
  "01KJ83B2W736W6DCN7Z4RHK7D7",
  // Zachary Obando
  "01KJAA4YRZZKK5CDK8316NEN8Q",
  "01KJ93S34NJQ91HNJTKV7MV5GQ",
  "01KJ87BDY5VWGRZ78EBC0390P1",
  // Vanessa Fortune
  "01KJ6MQW99CBVHPDQ3Y7HH80X0",
  "01KJ83624PN292QSY1CNGN4BWE",
  "01KJ8XXC01SHEAWFS144RRY9PK",
  // Edgar Arana
  "01KJ8SSQYCZWTT9E6TSY9X7Z4X",
  "01KJ8TQAB8GJ8XMR2FFFWWVPEY",
  "01KJ6B86ZJY7NYT077H5CXBAJB",
  // Alfred Du
  "01KHRFCZQEHWK333A0Q6HQQCJS",
  "01KJ3DP2050CKZH7AC1W3WFTDE",
  "01KHP9W6A7T0AVQ1F7W0DNA8M9",
  // Gleidson Rocha Da Silva
  "01KJ8EXH3K7B4N8A8DG3EFSWH6",
  "01KJAWS633DMGEMC7S7MH94CRD",
  "01KJ7ZPYZG0V55VYMPRMDWGEAP",
  // David Morawietz
  "01KJ82EQAD6DC1E35RA889EQ5W",
  "01KJ8D8VZDEKS8Z8D4GAGHV84E",
  "01KJ8RDRWJ4K6S6SHJT63AT7EQ",
  // Marysol Ortega
  "01KJ7BNDYBYQP2FFTTDNYXXY1K",
  "01KJ65Q8RS81SSKCV54XKZD72X",
  "01KHNTNGGSD1SNG0BKM1K1K7BA",
];

const CONCURRENCY = 2; // run 2 at a time to avoid rate limits

async function processOne(meetingId, index, total) {
  const label = `[${index + 1}/${total}]`;
  const start = Date.now();

  try {
    // Step 1: Fetch transcript
    console.log(`${label} Fetching transcript ${meetingId}...`);
    const transcript = await fetchTranscript(meetingId);
    console.log(`${label} Got: "${transcript.title}" (${transcript.repName}, ${transcript.durationMinutes}m)`);

    // Step 2: Score with Claude
    console.log(`${label} Scoring with Claude...`);
    const scorecard = await scoreTranscript({
      transcriptText: transcript.transcriptText,
      repName: transcript.repName,
      companyName: transcript.companyName,
      durationMinutes: transcript.durationMinutes,
    });
    console.log(`${label} Score: ${scorecard.score}/100 (${scorecard.rag})`);

    // Step 3: Save to database
    const meta = {
      repName: transcript.repName,
      companyName: transcript.companyName,
      date: transcript.date,
      durationMinutes: transcript.durationMinutes,
      meetingId,
    };
    const scorecardId = await saveScorecard(scorecard, meta);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${label} ✅ Saved ${scorecardId} in ${elapsed}s\n`);

    return { meetingId, success: true, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
  } catch (err) {
    console.error(`${label} ❌ FAILED ${meetingId}: ${err.message}\n`);
    return { meetingId, success: false, error: err.message };
  }
}

async function runBatch() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Killer Calls Batch Import`);
  console.log(`  ${MEETING_IDS.length} demos to process (concurrency: ${CONCURRENCY})`);
  console.log(`${"═".repeat(60)}\n`);

  const results = [];
  const queue = [...MEETING_IDS];
  let index = 0;

  // Process in batches of CONCURRENCY
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const promises = batch.map((id) => processOne(id, index++, MEETING_IDS.length));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    // Small delay between batches to be nice to APIs
    if (queue.length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Summary
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  IMPORT COMPLETE`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ✅ ${successes.length} scored and saved`);
  if (failures.length > 0) {
    console.log(`  ❌ ${failures.length} failed`);
  }

  if (successes.length > 0) {
    console.log(`\n  Scoreboard:`);
    successes
      .sort((a, b) => b.score - a.score)
      .forEach((r) => {
        const icon = r.rag === "green" ? "🟢" : r.rag === "yellow" ? "🟡" : "🔴";
        console.log(`  ${icon} ${String(r.score).padStart(3)}/100  ${r.rep}`);
      });
  }

  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    failures.forEach((r) => console.log(`  - ${r.meetingId}: ${r.error}`));
  }

  console.log();
  await pool.end();
}

runBatch().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
