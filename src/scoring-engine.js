// ─── Killer Calls Scoring Engine ─────────────────────────────────
// Sends call transcripts to DeepSeek for scoring against the
// SalesCloser.ai rubric. Returns a structured JSON scorecard.
// Requires: DEEPSEEK_API_KEY environment variable.

// ─── System prompts ──────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, the internal demo review system at SalesCloser.ai — an AI-powered sales platform. You analyze recorded demo call transcripts and produce structured JSON scorecards against a 100-point rubric.

Your scorecards are read by the AEs themselves and their sales managers. Every score you give directly shapes how reps coach themselves. Accuracy and consistency matter more than speed.

─── SCORING PHILOSOPHY ───

Be a tough but fair evaluator. You are calibrating a sales team — not grading on a curve and not handing out participation trophies. Score every criterion independently and let the total fall where it falls.

DO NOT target any particular score range. DO NOT aim for "most calls around X." There is no default score. Every call earns exactly what the rubric says it earns.

Scoring discipline per criterion:
• MAX POINTS: Award the full amount ONLY when the specific behavior described in the rubric is clearly and directly observed in the transcript.
• PARTIAL CREDIT: Award partial credit ONLY when there is direct evidence the rep attempted the behavior but execution was incomplete or flawed. Do NOT give partial credit for absence — "they probably did this off-camera" is not evidence.
• ZERO: Award zero when the behavior is absent from the transcript — no benefit of the doubt, no assumption the rep "would have" done it.

To force accurate scoring across the FULL 0-100 range:
• A rep who executes every phase with precision should score 90+. These are rare.
• A rep who does everything adequately but nothing exceptionally well should score in the 40s-50s. "Adequate" is not the same as "good."
• A rep who fumbles discovery, rambles through presentation, and never asks for the business should score in the 20s-30s. Be willing to go low.

The 100-point scale is there for a reason — use all of it. If two very different calls get the same score, something is wrong with your calibration.

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

PHASE 2 — QUALIFICATION (26 pts)
2. Agenda setting (5 pts)
   - Green (4-5): Clear agenda stated AND prospect confirmed/agreed
   - Yellow (2-3): Agenda stated but no buy-in
   - Red (0-1): No agenda set

3. QUICK qualification (21 pts total)
   - Q — Qualify current state (4 pts): Does the AE understand their current setup, tools, call volume?
   - U — Uncover the pain & future state (5 pts): Did the AE identify the specific problem? Did they AMPLIFY the pain (what is it costing them right now)? Did they ask where the prospect wants to be 3-6 months from now? Did they position the product as the bridge from current pain to desired future?
   - I — Identify budget & timeline (4 pts): Did the AE surface budget expectations and buying timeline?
   - C — Confirm decision process (4 pts): Did the AE ask who else is involved in the decision?
   - K — Keep it moving (4 pts): Did the AE avoid getting stuck in discovery? Efficient, not rambling.
   NOTE: This is a transactional sale. Discovery should be 5-10 minutes, not 20+. Score the QUALITY of questions asked, not the quantity of time spent. The U step is the most important qualifier — amplifying pain and connecting to future state is what separates a pitch from a prescription.

PHASE 3 — PRESENTATION (28 pts)
4. Smooth & professional (4 pts)
5. Confidence & leadership (7 pts) — AE led the conversation, spoke with authority, didn't defer to the prospect. Top closers speak 60-75% of the call. Dock points for: uncertainty, rambling explanations, excessive pauses.
6. Personalization (9 pts) — Features tied to prospect's stated pain
7. Tie-downs / micro-closes (8 pts) — Regular value checks and "does that make sense?" / "any questions so far?"

PHASE 4 — PRICING & OBJECTION HANDLING (22 pts)
8. Value summary before price (7 pts)
9. Simple pricing (5 pts) — One option, then silence. Don't present a menu.
10. No premature discount (2 pts) — Auto red flag if discount before ECIR
11. ECIR objection handling (8 pts) — Empathize, Clarify, Isolate, Respond per objection. Every objection is an opportunity — score each one independently.

PHASE 5 — CLOSE & NEXT STEPS (16 pts) — THIS PHASE DECIDES THE DEAL

12. Close execution (12 pts) — Score: Setup(4)/Bridge(4)/Ask(4).

THE ASK IS A BINARY GATE. These are NOT closes — they are DEFERRALS (0 pts for Ask):
  ❌ "I'll email you a link" / "Let me send you a follow-up"
  ❌ "Sign up when you're ready" / "Think about it and let me know"
  ❌ "Should I send you the agreement?" (not a question, it's a stall)
  ❌ "Let me know if you have any questions" (handoff, not a close)

A REAL close sounds like:
  ✅ "Can we get you started today?" / "Are you ready to move forward?"
  ✅ "Let's get you set up right now — I'll walk you through it."
  ✅ "Based on everything we covered, I think we should move forward. What do you think?"

Ask scoring — BINARY. There is no "partial" for a deferral:
  • 3-4 pts: A direct commitment question was asked AND silence was held for a response. "Can we get you started today?" / "Are you ready to move forward?" / "Let's do this — I'll send the agreement now."
  • 1-2 pts: An ambiguous next-step question was asked ("What do you think?" without a clear call to action) OR the AE filled the silence before the prospect answered.
  • 0 pts: NO commitment question was asked. Any variant of "I'll email/send/follow up" = ZERO. "Let me know when you're ready" = ZERO. "Think about it" = ZERO. If the AE hands off to email instead of asking for commitment, Ask score is ZERO — no exceptions, no partial credit.

Bridge scoring:
  • 3-4 pts: Surfaces remaining concerns directly. "What would stop you from moving forward today?"
  • 1-2 pts: Acknowledged potential hesitation but didn't surface it explicitly.
  • 0 pts: Skipped blocker check entirely, or prospect raised an objection and AE deflected.

Setup scoring:
  • 3-4 pts: Recaps 2-3 specific benefits tied to the prospect's stated pain BEFORE transitioning to close. Clear value anchor.
  • 1-2 pts: Brief value mention but not tied to discovery.
  • 0 pts: No value summary before asking (or before deferring).

A call where the AE summarizes value, handles objections, builds rapport — but then says "I'll send you an email with the link" — has FAILED the close phase. The Ask is 0. Bridge gets partial at best. Total for this phase should be 4-8 out of 16, not 12-16.

13. Scheduled follow-up (4 pts):
  • 4 pts: Specific date AND time locked on the call. Both parties confirmed. Calendar invite or Calendly booked live.
  • 2 pts: Date discussed but time not confirmed. "I'll send you a calendar invite."
  • 0 pts: "I'll follow up" / "We'll figure it out" / "I'll reach out" / "Keep me posted" — no commitment, no points.

─── OUTPUT FORMAT ───
Return ONLY this JSON (no prose, no markdown fences):
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 8, "criteria": { "research": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<2-3 sentences — include prep outreach if applicable>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 26, "criteria": { "agenda": { "score": <n>, "maxPoints": 5, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "quick": { "score": <n>, "maxPoints": 21, "feedback": "<efficiency note: was discovery fast and focused?>" } } },
    "presentation": { "score": <n>, "maxPoints": 28, "criteria": { "smooth": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "confidence": { "score": <n>, "maxPoints": 7, "rag": "g"|"y"|"r", "feedback": "<did the AE lead with authority or defer?>", "timestamps": ["MM:SS"] }, "personalization": { "score": <n>, "maxPoints": 9, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "tieDowns": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 22, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 7, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "simplePricing": { "score": <n>, "maxPoints": 5, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "noDiscount": { "score": <n>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "ecir": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [{ "topic": "<...>", "timestamp": "MM:SS", "empathize": true|false, "clarify": true|false, "isolate": true|false, "respond": true|false }] } } },
    "closing": { "score": <n>, "maxPoints": 16, "criteria": { "closeExecution": { "score": <n>, "maxPoints": 12, "rag": "g"|"y"|"r", "feedback": "<coaching feedback on close — did they ask for the business?>", "timestamps": ["MM:SS"] }, "followUp": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
  },
  "spiced": {
    "s": { "score": <0-4>, "status": "strong"|"partial"|"missing", "feedback": "<Q — Qualify: current setup, tools, call volume — 1-2 sentences>", "timestamps": ["MM:SS"] },
    "p": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<U — Uncover & Amplify: pain identified, cost amplified, future state explored, product positioned as bridge>", "timestamps": ["MM:SS"] },
    "i": { "score": <0-4>, "status": "strong"|"partial"|"missing", "feedback": "<I — Identify: budget expectations and timeline surfaced>", "timestamps": ["MM:SS"] },
    "c": { "score": <0-4>, "status": "strong"|"partial"|"missing", "feedback": "<C — Confirm: decision process and stakeholders mapped>", "timestamps": ["MM:SS"] },
    "e": { "score": <0-4>, "status": "strong"|"partial"|"missing", "feedback": "<K — Keep moving: efficient, didn't get stuck in discovery>", "timestamps": ["MM:SS"] }
  },
  "close": {
    "style": "consultative"|"assumptive"|"urgency"|"none",
    "styleName": "<e.g. 'Assumptive Close'>",
    "setup": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Summarized Value>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "bridge": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Transitioned to Commitment>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "ask": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<step name — e.g. Asked for Business>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
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

  let scorecard;
  try {
    scorecard = JSON.parse(cleaned);
  } catch (err) {
    // If JSON is truncated, try to salvage by closing braces
    if (err.message.includes('Unexpected end') && cleaned.startsWith('{')) {
      // Count open vs close braces and add missing ones
      let open = 0;
      for (const ch of cleaned) {
        if (ch === '{') open++;
        if (ch === '}') open--;
      }
      const salvaged = cleaned + '}'.repeat(Math.max(0, open));
      try {
        scorecard = JSON.parse(salvaged);
        console.warn('[scoring] Truncated JSON salvaged by adding ' + Math.max(0, open) + ' closing braces');
      } catch (e2) {
        throw new Error('DeepSeek returned truncated/unparseable JSON. Partial: ' + cleaned.substring(0, 300));
      }
    } else {
      throw new Error('DeepSeek returned invalid JSON: ' + err.message + '. Partial: ' + cleaned.substring(0, 300));
    }
  }
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

async function scoreTranscript({ transcriptText, repName, companyName, durationMinutes, systemPrompt, userPrompt }) {
  const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  const effectiveUserPrompt = userPrompt || buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);

  console.log('[scoring] Backend: deepseek');

  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: effectiveSystemPrompt },
      { role: "user", content: effectiveUserPrompt },
    ],
    temperature: 0.3,
    max_tokens: 16384,
    response_format: { type: "json_object" },
  };

  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000),
  });

  const data = await resp.text();

  if (resp.status !== 200) {
    throw new Error("DeepSeek API " + resp.status + ": " + data.substring(0, 200));
  }

  let json;
  try {
    json = JSON.parse(data);
  } catch (err) {
    throw new Error("DeepSeek returned non-JSON response (status " + resp.status + "). Raw: " + data.substring(0, 200));
  }

  // Check for API-level errors (DeepSeek returns 200 with error object on auth failures)
  if (json.error) {
    const errMsg = json.error.message || JSON.stringify(json.error);
    throw new Error("DeepSeek API error: " + errMsg);
  }

  const text = json.choices?.[0]?.message?.content;
  if (!text || text.trim().length === 0) {
    throw new Error("DeepSeek returned empty response. Raw: " + data.substring(0, 300));
  }

  return parseScorecardText(text);
}

// ─── Drill Scoring (Discovery Sandbox) ────────────────────────────

const DRILL_SYSTEM_PROMPT = `You are the scoring engine for Killer Calls Discovery Sandbox — a practice environment where sales reps run live voice drills against AI prospects. You evaluate drill transcripts against a targeted rubric that measures specific skills, not overall demo quality.

Your scorecards are read by the rep and their coach. Be honest, direct, and constructive. This is practice — the goal is skill development, not pipeline qualification.

─── SCORING PHILOSOPHY ───

You are scoring a PRACTICE DRILL, not a real demo. The rep is practicing specific skills in a controlled environment. Score strictly against the drill rubric. Do not evaluate presentation quality, closing technique, or other full-demo criteria unless specified in the drill rubric.

Be tough but fair. If the rep didn't capture the required information, score it zero. Partial credit only when the rep made a genuine attempt but execution was incomplete.

─── OUTPUT ───

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. Just the JSON object.

MANDATORY KEYS: score, rag, verdict, criteria (array of criterion results with name, score, max_score, passed, feedback), wins, fixes, quoteOfTheCall.`;

const DRILL_CRITERIA = {
  u_step: [
    { name: "dollar_figure_captured", max_score: 30, description: "Rep captured a specific dollar figure from the prospect" },
    { name: "six_month_consequence", max_score: 30, description: "Rep uncovered the 6-month consequence of inaction" },
    { name: "follow_up_depth", max_score: 20, description: "Rep asked at least 2 follow-up questions after the first pain answer" },
    { name: "discovery_under_15_min", max_score: 10, description: "Discovery phase ended before 15:00 mark" },
    { name: "talk_ratio_under_40pct", max_score: 10, description: "Rep spoke less than 40% of the discovery phase" },
  ]
};

function buildDrillScoringPrompt(transcriptText, repName, personaName, drillType) {
  const criteria = DRILL_CRITERIA[drillType] || DRILL_CRITERIA.u_step;

  return `Score the following drill call transcript against the U-Step drill rubric.

REP: ${repName}
DRILL: ${personaName || "Discovery Sandbox"}
TYPE: ${drillType || "u_step"}

─── DRILL SCORING RUBRIC (U-Step — 100 points) ───

${criteria.map((c, i) => `${i + 1}. ${c.name.replace(/_/g, " ")} (${c.max_score} pts) — ${c.description}`).join("\n")}

SCORING RULES:
- MAX POINTS: Award full credit ONLY when the specific behavior is clearly observed in the transcript.
- PARTIAL CREDIT: Award partial credit ONLY when there is direct evidence the rep attempted but execution was incomplete.
- ZERO: Award zero when the behavior is absent — no benefit of the doubt.

OUTPUT FORMAT:
Return a JSON object with:
{
  "score": <total 0-100>,
  "rag": "<green|yellow|red>",
  "verdict": "<one sentence overall assessment>",
  "criteria": [
    { "name": "<criterion_name>", "score": <0-max>, "max_score": <max>, "passed": <bool>, "feedback": "<specific evidence>" },
    ...
  ],
  "wins": ["<what went well>", ...],
  "fixes": ["<specific improvement>", ...],
  "quoteOfTheCall": "<verbatim quote from the transcript that best illustrates performance>"
}

SCORING THRESHOLDS:
- Green: ≥ 70
- Yellow: ≥ 50
- Red: < 50

TRANSCRIPT:
${transcriptText}`;
}

module.exports = {
  scoreTranscript,
  SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
  buildScoringPromptWithWeights,
  DRILL_SYSTEM_PROMPT,
  buildDrillScoringPrompt,
  DRILL_CRITERIA,
};
