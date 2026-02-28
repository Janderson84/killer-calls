#!/usr/bin/env node
require("dotenv").config();

const { execSync } = require("child_process");
const { fetchTranscript } = require("./src/fireflies-client");
const { saveScorecard, pool } = require("./src/db");
const { readFileSync, writeFileSync, mkdirSync } = require("fs");
const path = require("path");

// ─── 27 real demo calls — 3 per AE ─────────────────────────────
const MEETING_IDS = [
  "01KHVYQPSJJXTNYYMM85ZAAEXV", "01KJ8F40MY1ATWS0BW7SNT8XSM", "01KHVYQPSKK1RVD9KXQWYY6KZK",
  "01KJ8B09BSJR58AY4QS86078V2", "01KJ604GXC9ZZP74WDCM53E09P", "01KJ83B2W736W6DCN7Z4RHK7D7",
  "01KJAA4YRZZKK5CDK8316NEN8Q", "01KJ93S34NJQ91HNJTKV7MV5GQ", "01KJ87BDY5VWGRZ78EBC0390P1",
  "01KJ6MQW99CBVHPDQ3Y7HH80X0", "01KJ83624PN292QSY1CNGN4BWE", "01KJ8XXC01SHEAWFS144RRY9PK",
  "01KJ8SSQYCZWTT9E6TSY9X7Z4X", "01KJ8TQAB8GJ8XMR2FFFWWVPEY", "01KJ6B86ZJY7NYT077H5CXBAJB",
  "01KHRFCZQEHWK333A0Q6HQQCJS", "01KJ3DP2050CKZH7AC1W3WFTDE", "01KHP9W6A7T0AVQ1F7W0DNA8M9",
  "01KJ8EXH3K7B4N8A8DG3EFSWH6", "01KJAWS633DMGEMC7S7MH94CRD", "01KJ7ZPYZG0V55VYMPRMDWGEAP",
  "01KJ82EQAD6DC1E35RA889EQ5W", "01KJ8D8VZDEKS8Z8D4GAGHV84E", "01KJ8RDRWJ4K6S6SHJT63AT7EQ",
  "01KJ7BNDYBYQP2FFTTDNYXXY1K", "01KJ65Q8RS81SSKCV54XKZD72X", "01KHNTNGGSD1SNG0BKM1K1K7BA",
];

const TMP_DIR = path.join(__dirname, ".tmp-transcripts");

// ─── Scoring prompt (same rubric as scoring-engine.js) ──────────
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
12. Pushed to close (10 pts) - Green: Genuine close attempt
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
    "closing": { "score": <n>, "maxPoints": 12, "criteria": { "pushToClose": { "score": <n>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "followUp": { "score": <n>, "maxPoints": 2, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
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

// ─── Score via OpenClaw ─────────────────────────────────────────
function scoreViaOpenClaw(promptFilePath, sessionId) {
  // Read prompt and escape for shell
  const prompt = readFileSync(promptFilePath, "utf8");
  const escapedPath = promptFilePath.replace(/'/g, "'\\''");
  const cmd = `openclaw agent -m "$(cat '${escapedPath}')" --json --session-id "${sessionId}" --timeout 180 2>/dev/null`;
  const result = execSync(cmd, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 240000,
    env: { ...process.env, NODE_OPTIONS: "" },
  }).toString();

  // Parse OpenClaw JSON envelope
  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    parsed = { result: { payloads: [{ text: result }] } };
  }

  // Extract text from OpenClaw response structure
  const text = parsed?.result?.payloads?.[0]?.text
    || parsed.text || parsed.content || parsed.message || result;

  // Find and parse the scorecard JSON from the response
  let cleaned = text.trim();
  // Strip markdown fences if present
  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) cleaned = match[1];
  }
  // Find the JSON object
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  const scorecard = JSON.parse(cleaned);
  if (typeof scorecard.score !== "number" || !scorecard.rag) {
    throw new Error("OpenClaw response missing required fields (score, rag)");
  }
  return scorecard;
}

// ─── Process one call ───────────────────────────────────────────
async function processOne(meetingId, index, total) {
  const label = `[${index + 1}/${total}]`;
  const start = Date.now();

  try {
    console.log(`${label} Fetching transcript ${meetingId}...`);
    const transcript = await fetchTranscript(meetingId);
    console.log(`${label} Got: "${transcript.title}" (${transcript.repName}, ${transcript.durationMinutes}m)`);

    // Write prompt to temp file (too large for command line arg)
    const prompt = buildOpenClawPrompt(
      transcript.transcriptText, transcript.repName,
      transcript.companyName, transcript.durationMinutes
    );
    const promptFile = path.join(TMP_DIR, `${meetingId}.txt`);
    writeFileSync(promptFile, prompt);

    console.log(`${label} Scoring via OpenClaw...`);
    const sessionId = `killer-calls-score-${meetingId}`;
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

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${label} ✅ Saved ${scorecardId} in ${elapsed}s\n`);
    return { meetingId, success: true, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
  } catch (err) {
    console.error(`${label} ❌ FAILED ${meetingId}: ${err.message}\n`);
    return { meetingId, success: false, error: err.message };
  }
}

// ─── Main ───────────────────────────────────────────────────────
async function runBatch() {
  mkdirSync(TMP_DIR, { recursive: true });

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Killer Calls Batch Import (via OpenClaw)`);
  console.log(`  ${MEETING_IDS.length} demos to process sequentially`);
  console.log(`${"═".repeat(60)}\n`);

  const results = [];
  for (let i = 0; i < MEETING_IDS.length; i++) {
    const r = await processOne(MEETING_IDS[i], i, MEETING_IDS.length);
    results.push(r);
  }

  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  IMPORT COMPLETE`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ✅ ${successes.length} scored and saved`);
  if (failures.length) console.log(`  ❌ ${failures.length} failed`);

  if (successes.length > 0) {
    console.log(`\n  Scoreboard:`);
    successes.sort((a, b) => b.score - a.score).forEach((r) => {
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
