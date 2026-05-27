// ─── Killer Calls Scoring Engine ─────────────────────────────────
// Sends call transcripts to DeepSeek for scoring against the
// SalesCloser.ai rubric. Returns a structured JSON scorecard.
// Requires: DEEPSEEK_API_KEY environment variable.

// ─── System prompts ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, the internal demo review system at SalesCloser.ai — an AI-powered sales platform. You analyze recorded demo call transcripts and produce structured JSON scorecards against a 100-point rubric.

Your scorecards are read by the AEs themselves and their sales managers. Every score you give directly shapes how reps coach themselves. Accuracy and consistency matter more than speed.

─── SCORING PHILOSOPHY ───

Be a tough but fair evaluator. You are calibrating a sales team — not grading on a curve and not handing out participation trophies.

Score distribution guidance:
• 85-100 (Green): Exceptional. The rep qualified efficiently, presented with confidence, handled objections, and executed a strong close with a clear next step. Reserved for calls that moved the deal forward. Most calls should NOT score this high.
• 60-84 (Yellow): Solid but with clear gaps. This is where the majority of calls should land. Good reps will consistently be in the 65-80 range. A 75 is a good call.
• Below 60 (Red): Significant missed opportunities — no close attempt, weak objection handling, or rambling presentation. Don't hesitate to score in the 30s-40s if the call warrants it.

Score honestly but frame feedback constructively. This is a transactional software sale (~$650/mo) — the AE should lead confidently, qualify fast, demo the product, handle objections, and close on the call. Top-performing AEs at Wishpond (the parent company) spend 60-70% of the call on presentation and close, with only 5-10% on discovery. If no objections were raised or handled, that's 0 for objection handling — do not give partial credit for something that didn't happen. The most important question: did the AE ask for the business?

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

MANDATORY: You MUST include ALL top-level keys in the JSON output: score, rag, verdict, phases, spiced, close, closingTips, wins, fixes, flags, quoteOfTheCall. The "spiced" key uses QUICK framework labels. The "close" object is REQUIRED — never omit it. If no close was attempted, use style: "none".`;

const FOLLOWUP_SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, evaluating a FOLLOW-UP call where the AE has already had a discovery call with this prospect.

Key difference: Do NOT penalize for skipping full discovery. Instead, evaluate whether the AE effectively advanced the deal toward close by resolving objections, continuing the presentation, handling pricing, and executing a strong close.

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. Just the JSON object.

MANDATORY: You MUST include ALL top-level keys: score, rag, verdict, phases, spiced, close, closingTips, wins, fixes, flags, quoteOfTheCall. The "close" object is REQUIRED.`;

// ─── Scoring prompt builders ─────────────────────────────────────

function buildScoringPrompt(transcriptText, repName, companyName, durationMinutes) {
  return `Score the following sales demo transcript.

REP: ${repName}
PROSPECT: ${companyName}
DURATION: ${durationMinutes || "unknown"} minutes

─── SCORING RUBRIC (100 points total) ───

PHASE 1 — PRE-CALL PREPARATION (8 pts)
1. Research & prep outreach (8 pts)
   - Green (6-8): Industry/role knowledge evident, referenced specific details, sent prep materials before call
   - Yellow (3-5): Some research but surface-level
   - Red (0-2): No evidence of preparation

PHASE 2 — QUALIFICATION (18 pts)
2. Agenda setting (5 pts)
   - Green (4-5): Clear agenda stated AND prospect confirmed/agreed
   - Yellow (2-3): Agenda stated but no buy-in
   - Red (0-1): No agenda set

3. QUICK qualification (13 pts total)
   - Q — Qualify current state (3 pts): Does the AE understand their current setup, tools, call volume?
   - U — Uncover the pain & future state (3 pts): Did the AE identify the specific problem? Did they AMPLIFY the pain (what is it costing them right now)? Did they ask where the prospect wants to be 3-6 months from now? Did they position the product as the bridge from current pain to desired future?
   - I — Identify budget & timeline (3 pts): Did the AE surface budget expectations and buying timeline?
   - C — Confirm decision process (2 pts): Did the AE ask who else is involved in the decision?
   - K — Keep it moving (2 pts): Did the AE avoid getting stuck in discovery? Efficient, not rambling.
   NOTE: This is a transactional sale. Discovery should be 5-10 minutes, not 20+. Score the QUALITY of questions asked, not the quantity of time spent. The U step is the most important qualifier — amplifying pain and connecting to future state is what separates a pitch from a prescription.

PHASE 3 — PRESENTATION (24 pts)
4. Smooth & professional (4 pts)
5. Confidence & leadership (6 pts) — AE led the conversation, spoke with authority, didn't defer to the prospect. Top closers speak 60-75% of the call. Dock points for: uncertainty, rambling explanations, excessive pauses.
6. Personalization (8 pts) — Features tied to prospect's stated pain
7. Tie-downs / micro-closes (6 pts) — Regular value checks and "does that make sense?" / "any questions so far?"

PHASE 4 — PRICING & OBJECTION HANDLING (28 pts)
8. Value summary before price (8 pts)
9. Simple pricing (6 pts) — One option, then silence. Don't present a menu.
10. No premature discount (2 pts) — Auto red flag if discount before ECIR
11. ECIR objection handling (12 pts) — Empathize, Clarify, Isolate, Respond per objection. Every objection is an opportunity — score each one independently.

PHASE 5 — CLOSE & NEXT STEPS (22 pts)
12. Close execution (18 pts) — This is the most important phase. Detect the closing style:
    - Consultative: Summarize value / Surface blockers / Ask for business
    - Assumptive: Read buying signals / Transition to next steps / Lock in commitment
    - Urgency: Tie to event or deadline / Build timeline / Propose immediate action
    Score: Setup(6)/Bridge(6)/Ask(6). Award full points for: trial close attempt, handling hesitation without folding, clear ask for commitment, sending agreement/payment link on the call.
13. Scheduled follow-up (4 pts) — Specific date/time booked before hanging up. Bonus: prep materials or summary sent during the call.

─── OUTPUT FORMAT ───
Return ONLY this JSON (no prose, no markdown fences):
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 8, "criteria": { "research": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<2-3 sentences — include prep outreach if applicable>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 18, "criteria": { "agenda": { "score": <n>, "maxPoints": 5, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "quick": { "score": <n>, "maxPoints": 13, "feedback": "<efficiency note: was discovery fast and focused?>" } } },
    "presentation": { "score": <n>, "maxPoints": 24, "criteria": { "smooth": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "confidence": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<did the AE lead with authority or defer?>", "timestamps": ["MM:SS"] }, "personalization": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "tieDowns": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 28, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "simplePricing": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "noDiscount": { "score": <n>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ecir": { "score": <n>, "maxPoints": 12, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [{ "topic": "<...>", "timestamp": "MM:SS", "empathize": true|false, "clarify": true|false, "isolate": true|false, "respond": true|false }] } } },
    "closing": { "score": <n>, "maxPoints": 22, "criteria": { "closeExecution": { "score": <n>, "maxPoints": 18, "rag": "g"|"y"|"r", "feedback": "<coaching feedback on close — did they ask for the business?>", "timestamps": ["MM:SS"] }, "followUp": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
  },
  "spiced": {
    "s": { "score": <0-3>, "status": "strong"|"partial"|"missing", "feedback": "<Q — Qualify: current setup, tools, call volume — 1-2 sentences>", "timestamps": ["MM:SS"] },
    "p": { "score": <0-3>, "status": "strong"|"partial"|"missing", "feedback": "<U — Uncover & Amplify: pain identified, cost amplified, future state explored, product positioned as bridge>", "timestamps": ["MM:SS"] },
    "i": { "score": <0-3>, "status": "strong"|"partial"|"missing", "feedback": "<I — Identify: budget expectations and timeline surfaced>", "timestamps": ["MM:SS"] },
    "c": { "score": <0-2>, "status": "strong"|"partial"|"missing", "feedback": "<C — Confirm: decision process and stakeholders mapped>", "timestamps": ["MM:SS"] },
    "e": { "score": <0-2>, "status": "strong"|"partial"|"missing", "feedback": "<K — Keep moving: efficient, didn't get stuck in discovery>", "timestamps": ["MM:SS"] }
  },
  "close": {
    "style": "consultative"|"assumptive"|"urgency"|"none",
    "styleName": "<e.g. 'Assumptive Close'>",
    "setup": { "score": <0-6>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Summarized Value>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "bridge": { "score": <0-6>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Transitioned to Commitment>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "ask": { "score": <0-6>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Asked for Business>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
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
  "close": { "style": "consultative"|"assumptive"|"urgency"|"none", "styleName": "<...>", "setup": { "score": <0-10>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] }, "bridge": { "score": <0-8>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ask": { "score": <0-12>, "status": "strong"|"partial"|"missing", "label": "<...>", "feedback": "<...>", "timestamps": ["MM:SS"] } },
  "closingTips": ["<tip 1>", "<tip 2>"],
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

// ─── Scorecard parser ─────────────────────────────────────────────

function parseScorecardText(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?[\s]*\n?([\s\S]*?)\n?```/);
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

// ─── Main scoring function (DeepSeek only) ────────────────────────

function scoreTranscript({ transcriptText, repName, companyName, durationMinutes, systemPrompt, userPrompt }) {
  const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  const effectiveUserPrompt = userPrompt || buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);

  console.log('[scoring] Backend: deepseek');

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const https = require("https");
  const payload = JSON.stringify({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: effectiveSystemPrompt },
      { role: "user", content: effectiveUserPrompt },
    ],
    temperature: 0.1,
    max_tokens: 8192,
    response_format: { type: "json_object" },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.deepseek.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
        },
        timeout: 300000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error("DeepSeek API " + res.statusCode + ": " + data.substring(0, 200)));
          }
          try {
            const json = JSON.parse(data);
            const text = json.choices?.[0]?.message?.content || "";
            resolve(parseScorecardText(text));
          } catch (err) {
            reject(new Error("DeepSeek parse error: " + err.message + ". Raw: " + data.substring(0, 200)));
          }
        });
      }
    );
    req.on("error", (err) => reject(new Error("DeepSeek API error: " + err.message)));
    req.on("timeout", () => { req.destroy(); reject(new Error("DeepSeek API timeout")); });
    req.write(payload);
    req.end();
  });
}

module.exports = {
  scoreTranscript,
  SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
  buildScoringPromptWithWeights,
};
