const { execSync } = require("child_process");
const { CONFIG } = require("./constants");

// ─── Scoring Engine ──────────────────────────────────────────────
// Sends a transcript to the configured LLM backend with the full
// 14-criterion rubric. Returns a structured JSON scorecard.
//
// BACKENDS (set SCORING_BACKEND env var):
//   - openclaw (default): Uses `openclaw agent` CLI to call the
//     local OpenClaw Gateway. Works when gateway is accessible.
//   - anthropic: Uses Anthropic SDK directly. Requires valid
//     ANTHROPIC_API_KEY. For cloud-only deployments.

const SCORING_BACKEND = process.env.SCORING_BACKEND || "openclaw";

// ─── Shared system prompt (identical to original) ────────────────
const SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, the internal demo review system at SalesCloser.ai — an AI-powered sales platform. You analyze recorded demo call transcripts and produce structured JSON scorecards against a 14-criterion, 100-point rubric using the SPICED, BANT, and ECIR frameworks, with flexible closing style evaluation.

Your scorecards are read by the AEs themselves and their sales managers. Every score you give directly shapes how reps coach themselves. Accuracy and consistency matter more than speed.

─── SCORING PHILOSOPHY ───

Be a tough but fair evaluator. You are calibrating a sales team — not grading on a curve and not handing out participation trophies.

Score distribution guidance:
• 85-100 (Green): Exceptional. The rep executed nearly every phase well. Reserved for calls where discovery was thorough, pricing was handled cleanly, and a genuine close attempt was made. Most calls should NOT score this high.
• 60-84 (Yellow): Solid but with clear gaps. This is where the majority of calls should land. Good reps will consistently be in the 65-80 range. A 75 is a good call.
• Below 60 (Red): Significant missed opportunities — weak discovery, no close attempt, or major framework gaps. Don't hesitate to score in the 30s-40s if the call warrants it.

Score honestly but frame feedback constructively. A call where the AE talked for 80% of the time, skipped discovery, and ended with "I'll send you a proposal" is a 35, not a 55 — but the feedback should help them see the path to 65, not just document what went wrong. If no objections were raised, that's 0/12 for ECIR — do not give partial credit for something that didn't happen.

Award points only for behaviors you can directly observe in the transcript. "They probably prepared" is not evidence — you need to hear the rep reference specific details about the prospect's business. Absence of evidence is not ambiguous — it's a zero for that criterion.

─── COACHING VOICE ───

You are a supportive sales coach who believes every rep can improve. Be specific, direct, and encouraging. The AEs read these scorecards personally — every word shapes their confidence and growth.

Rules:
• Name the rep in feedback. These are real people reviewing their own calls.
• Reference specific timestamps for every observation.
• Frame fixes as "try this next time" or "here's how to level up" — NOT as failures or mistakes.
• Lead with what went right before suggesting what to improve.
• Wins should highlight what specifically worked and why, so the rep knows to repeat it.
• The verdict should be encouraging and specific — like a coach who sees potential, not a grader pointing out flaws.
• Never use harsh language. "Failed to", "didn't bother", "completely missed" — rewrite as "opportunity to", "next time try", "this is an area to develop".

─── TRANSCRIPT HANDLING ───

These transcripts come from Fireflies.ai and have known quirks:
• Speaker attribution is sometimes wrong — if "Unknown Speaker" says something that's clearly the AE's pitch, treat it as the AE speaking.
• Timestamps are in MM:SS format. Use them as provided. Never fabricate a timestamp.

─── OUTPUT ───

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. No explanatory text. Just the JSON object as specified in the scoring prompt.

MANDATORY: You MUST include ALL top-level keys in the JSON output: score, rag, verdict, phases, spiced, bant, close, closingTips, wins, fixes, flags, quoteOfTheCall. The "close" object is REQUIRED — never omit it. If no close was attempted, use style: "none".`;

const FOLLOWUP_SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, evaluating a FOLLOW-UP call where the AE has already had a discovery call with this prospect.

Key difference: Do NOT penalize for skipping full discovery. Instead, evaluate whether the AE effectively advanced the deal toward close by resolving objections, continuing the presentation, handling pricing, and executing a strong close.

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. Just the JSON object.

MANDATORY: You MUST include ALL top-level keys: score, rag, verdict, phases, spiced, bant, close, closingTips, wins, fixes, flags, quoteOfTheCall. The "close" object is REQUIRED.`;

function buildScoringPrompt(transcriptText, repName, companyName, durationMinutes) {
  return `Score the following sales demo transcript.

REP: ${repName}
PROSPECT: ${companyName}
DURATION: ${durationMinutes || "unknown"} minutes

─── SCORING RUBRIC (100 points total) ───

PHASE 1 — PRE-CALL PREPARATION (6 pts)
1. Research & preparation (6 pts)
   - Green (5-6): Industry/role knowledge evident, referenced specific details about prospect
   - Yellow (3-4): Some research but surface-level
   - Red (0-2): No evidence of preparation

PHASE 2 — DISCOVERY (32 pts)
2. Agenda setting (7 pts)
   - Green (6-7): Clear agenda stated AND prospect confirmed/agreed
   - Yellow (3-5): Agenda stated but no buy-in
   - Red (0-2): No agenda set

3. SPICED discovery (25 pts total — 5 pts per element)
   - S — Situation (5 pts): What is the prospect's current setup, team size, context?
   - P — Pain (5 pts): Did the AE uncover a specific, named business problem?
   - I — Impact (5 pts): Did the AE quantify what the pain costs the business?
   - C — Critical Event (5 pts): Is there a deadline or event that creates urgency?
   - E — Decision (5 pts): Did the AE map the decision process, timeline, and stakeholders?

PHASE 3 — PRESENTATION (22 pts)
4. Smooth & professional (4 pts)
5. Talk ratio (6 pts) — No unbroken AE stretch >90s, prospect spoke ~40%
6. Personalization (8 pts) — Features tied to prospect's stated pain
7. Tie-downs / micro-closes (4 pts) — Regular value checks

PHASE 4 — PRICING & OBJECTION HANDLING (28 pts)
8. Value summary before price (8 pts)
9. Simple pricing (6 pts) — One option, then silence
10. No premature discount (2 pts) — Auto red flag if discount before ECIR
11. ECIR objection handling (12 pts) — Empathize, Clarify, Isolate, Respond per objection

PHASE 5 — CLOSE & NEXT STEPS (12 pts)
12. Close execution (10 pts) — 3 closing styles: Consultative (Summarize/Surface Blockers/Ask), Assumptive (Read Signals/Transition/Lock Action), Urgency (Tie Event/Build Timeline/Propose Plan). Detect the style, score Setup(4)/Bridge(3)/Ask(3).
13. Scheduled follow-up (2 pts)

BANT QUALIFICATION (separate from 100-pt score, 0-5 each):
B=Budget, A=Authority, N=Need, T=Timeline

─── OUTPUT FORMAT ───
Return ONLY this JSON (no prose, no markdown fences):
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 6, "criteria": { "research": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<2-3 sentences>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 32, "criteria": { "agenda": { "score": <n>, "maxPoints": 7, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "spiced": { "score": <n>, "maxPoints": 25 } } },
    "presentation": { "score": <n>, "maxPoints": 22, "criteria": { "smooth": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "talkRatio": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "personalization": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "tieDowns": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 28, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "simplePricing": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "noDiscount": { "score": <n>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ecir": { "score": <n>, "maxPoints": 12, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [{ "topic": "<...>", "timestamp": "MM:SS", "empathize": true|false, "clarify": true|false, "isolate": true|false, "respond": true|false }] } } },
    "closing": { "score": <n>, "maxPoints": 12, "criteria": { "closeExecution": { "score": <n>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<coaching feedback on close>", "timestamps": ["MM:SS"] }, "followUp": { "score": <n>, "maxPoints": 2, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
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
  "closingTips": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "wins": ["<win 1>", "<win 2>", "<win 3>"],
  "fixes": ["<fix 1>", "<fix 2>"],
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

function buildFollowupScoringPrompt(transcriptText, repName, companyName, durationMinutes, priorCallContext) {
  const priorBlock = priorCallContext
    ? `

─── PRIOR CALL CONTEXT ───
${priorCallContext}
─── END PRIOR CONTEXT ───`
    : "";

  return `Score the following FOLLOW-UP sales demo transcript.

REP: ${repName}
PROSPECT: ${companyName}
DURATION: ${durationMinutes || "unknown"} minutes
CALL TYPE: Follow-up${priorBlock}

This is a FOLLOW-UP call. Do NOT penalize the rep for skipping full discovery. Instead evaluate: recap, objection resolution, close execution.

─── SCORING RUBRIC (100 points total) ───
PHASE 1 — RECAP & CONTEXT (10 pts)
PHASE 2 — OBJECTION RESOLUTION (25 pts) — ECIR per objection
PHASE 3 — PRESENTATION CONTINUATION (15 pts)
PHASE 4 — PRICING & NEGOTIATION (20 pts)
PHASE 5 — CLOSE EXECUTION (30 pts) — Detect style, score Setup/Bridge/Ask

BANT evaluated separately (does not affect 100-pt score).

─── OUTPUT FORMAT ───
Return ONLY this JSON:
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 10, "criteria": { "recap": { "score": <n>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 25, "criteria": { "ecir": { "score": <n>, "maxPoints": 25, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [] } } },
    "presentation": { "score": <n>, "maxPoints": 15, "criteria": { "continuation": { "score": <n>, "maxPoints": 15, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 20, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 8 }, "simplePricing": { "score": <n>, "maxPoints": 6 }, "noDiscount": { "score": <n>, "maxPoints": 2 }, "negotiation": { "score": <n>, "maxPoints": 4 } } },
    "closing": { "score": <n>, "maxPoints": 30, "criteria": { "closeExecution": { "score": <n>, "maxPoints": 30, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
  },
  "spiced": { "s": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] }, "p": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] }, "i": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] }, "c": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] }, "e": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] } },
  "bant": { "b": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }, "a": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }, "n": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }, "t": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] } },
  "close": { "style": "consultative"|"assumptive"|"urgency"|"none", "styleName": "<...>", "setup": { "score": <0-10>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] }, "bridge": { "score": <0-8>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ask": { "score": <0-12>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] } },
  "closingTips": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "wins": ["<win 1>", "<win 2>"],
  "fixes": ["<fix 1>", "<fix 2>"],
  "flags": { "enthusiasm": { "detected": false, "note": "" }, "unprofessionalLanguage": { "detected": false, "note": "" }, "prematureDisqualification": { "detected": false, "note": "" } },
  "quoteOfTheCall": { "text": "<exact quote>", "timestamp": "MM:SS", "context": "<why it matters>" }
}

─── TRANSCRIPT ───

${transcriptText}`;
}

function buildScoringPromptWithWeights(transcriptText, repName, companyName, durationMinutes, weights) {
  let base = buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);
  if (weights && Object.keys(weights).length > 0) {
    base += `

─── TEAM-SPECIFIC WEIGHT OVERRIDES ───
${JSON.stringify(weights, null, 2)}`;
  }
  return base;
}

// ─── Parse scorecard text (shared between backends) ─────────────

function parseScorecardText(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?[s]*n?([sS]*?)n?```/);
    if (match) cleaned = match[1];
  }
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  const scorecard = JSON.parse(cleaned);
  if (typeof scorecard.score !== 'number' || !scorecard.rag) {
    throw new Error('Scoring response missing required fields (score, rag)');
  }

  // Ensure close object always exists
  if (!scorecard.close) {
    scorecard.close = {
      style: 'none',
      styleName: 'No Close Detected',
      setup: { score: 0, status: 'missing', label: 'No setup detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
      bridge: { score: 0, status: 'missing', label: 'No bridge detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
      ask: { score: 0, status: 'missing', label: 'No ask detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
    };
  }

  return scorecard;
}

// ─── OpenClaw scoring backend ──────────────────────────────────

function scoreViaOpenClaw(systemPrompt, userPrompt) {
  // Combine system + user prompt for the openclaw agent CLI
  const fullPrompt = systemPrompt
    ? systemPrompt + '  Now score the following transcript as instructed:  ' + userPrompt
    : userPrompt;

  const fs = require('fs');
  const os = require('os');
  const tmpFile = os.tmpdir() + '/killer-calls-prompt-' + Date.now() + '.txt';
  fs.writeFileSync(tmpFile, fullPrompt);

  const sessionId = 'killer-calls-score-' + Date.now();

  try {
    const cmd = 'openclaw agent -m "$(cat ' + shellQuote(tmpFile) + ')" --json --session-id ' + sessionId + ' --timeout 300 2>/dev/null';
    const rawResult = execSync(cmd, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 360000,
      env: { ...process.env, NODE_OPTIONS: '' },
    }).toString();

    // OpenClaw may print a "Doctor" banner before the JSON.
    // Strip everything before the first '{'
    const firstBrace = rawResult.indexOf('{');
    const lastBrace = rawResult.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('No JSON found in OpenClaw output');
    }
    const jsonStr = rawResult.substring(firstBrace, lastBrace + 1);

    // Parse the OpenClaw response wrapper
    const openclawResponse = JSON.parse(jsonStr);

    // Extract the actual scorecard text
    const text =
      openclawResponse?.result?.payloads?.[0]?.text ||
      openclawResponse.text ||
      openclawResponse.content ||
      openclawResponse.message ||
      jsonStr;

    return parseScorecardText(text);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

function shellQuote(str) {
  // Simple single-quote escaping for bash
  return "'" + str.replace(/'/g, "'''") + "'";
}

// ─── Anthropic scoring backend (fallback for cloud deployments) ──

function scoreViaAnthropic(systemPrompt, userPrompt) {
  const fs = require('fs');
  const os = require('os');
  const tmpDir = os.tmpdir();
  const inputFile = tmpDir + '/kc-anthropic-input-' + Date.now() + '.json';
  const scriptFile = tmpDir + '/kc-anthropic-runner-' + Date.now() + '.js';

  fs.writeFileSync(inputFile, JSON.stringify({
    systemPrompt,
    userPrompt,
    model: CONFIG.claudeModel,
    apiKey: process.env.ANTHROPIC_API_KEY,
  }));

  const runnerCode = [
    'const Anthropic = require("@anthropic-ai/sdk");',
    'const fs = require("fs");',
    'const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));',
    'const client = new Anthropic({ apiKey: data.apiKey });',
    '(async () => {',
    '  try {',
    '    const msg = await client.messages.create({',
    '      model: data.model, max_tokens: 8192,',
    '      system: data.systemPrompt,',
    '      messages: [{ role: "user", content: data.userPrompt }],',
    '    });',
    '    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");',
    '    process.stdout.write(text);',
    '  } catch (err) {',
    '    process.stderr.write(err.message + String.fromCharCode(10));',
    '    process.exit(1);',
    '  }',
    '})();',
  ].join(String.fromCharCode(10));

  fs.writeFileSync(scriptFile, runnerCode);

  try {
    const rawResult = execSync('node ' + shellQuote(scriptFile) + ' ' + shellQuote(inputFile), {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 360000,
    }).toString();

    return parseScorecardText(rawResult);
  } finally {
    try { fs.unlinkSync(inputFile); } catch (e) {}
    try { fs.unlinkSync(scriptFile); } catch (e) {}
  }
}

// ─── Main scoring function ──────────────────────────────────────

function scoreTranscript({ transcriptText, repName, companyName, durationMinutes, systemPrompt, userPrompt }) {
  const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  const effectiveUserPrompt = userPrompt || buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);

  console.log('[scoring] Backend: ' + SCORING_BACKEND);

  if (SCORING_BACKEND === 'openclaw') {
    return scoreViaOpenClaw(effectiveSystemPrompt, effectiveUserPrompt);
  } else if (SCORING_BACKEND === 'anthropic') {
    return scoreViaAnthropic(effectiveSystemPrompt, effectiveUserPrompt);
  } else {
    throw new Error('Unknown SCORING_BACKEND: ' + SCORING_BACKEND + '. Use "openclaw" or "anthropic".');
  }
}

module.exports = {
  scoreTranscript,
  SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
  buildScoringPromptWithWeights,
};
