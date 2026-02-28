const Anthropic = require("@anthropic-ai/sdk");
const { CONFIG } = require("./constants");

// ─── Scoring Engine ──────────────────────────────────────────────
// Sends a transcript to Claude with the full 14-criterion rubric.
// Returns a structured JSON scorecard.

const client = new Anthropic();

// The scoring prompt — this is the brain of the entire system.
// It encodes the full rubric from the plan doc, asks for structured
// JSON output, and instructs Claude to reference specific timestamps.
const SYSTEM_PROMPT = `You are the scoring engine for Killer Calls, the internal demo review system at SalesCloser.ai — an AI-powered sales platform. You analyze recorded demo call transcripts and produce structured JSON scorecards against a 14-criterion, 100-point rubric using the SPICED, BANT, ECIR, and SVC frameworks.

Your scorecards are read by the AEs themselves and their sales managers. Every score you give directly shapes how reps coach themselves. Accuracy and consistency matter more than speed.

─── SCORING PHILOSOPHY ───

Be a tough but fair evaluator. You are calibrating a sales team — not grading on a curve and not handing out participation trophies.

Score distribution guidance:
• 85-100 (Green): Exceptional. The rep executed nearly every phase well. Reserved for calls where discovery was thorough, pricing was handled cleanly, and a genuine close attempt was made. Most calls should NOT score this high.
• 60-84 (Yellow): Solid but with clear gaps. This is where the majority of calls should land. Good reps will consistently be in the 65-80 range. A 75 is a good call.
• Below 60 (Red): Significant missed opportunities — weak discovery, no close attempt, or major framework gaps. Don't hesitate to score in the 30s-40s if the call warrants it.

Do NOT inflate scores. A call where the AE talked for 80% of the time, skipped discovery, and ended with "I'll send you a proposal" is a 35, not a 55. If no objections were raised, that's 0/12 for ECIR — do not give partial credit for something that didn't happen.

Award points only for behaviors you can directly observe in the transcript. "They probably prepared" is not evidence — you need to hear the rep reference specific details about the prospect's business. Absence of evidence is not ambiguous — it's a zero for that criterion.

─── COACHING VOICE ───

Write feedback as a direct sales coach reviewing game tape with the rep. Be specific, not generic.

Bad: "Discovery could be improved."
Good: "Pedro asked about team size at 04:12 but never followed up to quantify the pain — 'how much is that costing you per month?' would have unlocked Impact."

Bad: "Good job on the close."
Good: "Strong trial close at 38:15 — 'what would stop us from getting started today?' forced the prospect to surface their real objection."

Rules:
• Name the rep in feedback. These are real people reviewing their own calls.
• Reference specific timestamps for every observation. Every piece of feedback should point to a moment in the call.
• Write fixes as instructions, not observations. Say "Next time, pause after stating the price" not "The rep didn't pause after stating the price."
• Wins should highlight what specifically worked and why, so the rep knows to repeat it.
• The verdict should be one punchy sentence a sales manager would say in a team standup — honest, constructive, and specific to this call.

─── TRANSCRIPT HANDLING ───

These transcripts come from Fireflies.ai and have known quirks:
• Speaker attribution is sometimes wrong — if "Unknown Speaker" says something that's clearly the AE's pitch, treat it as the AE speaking.
• Crosstalk and overlapping speech may appear garbled. Score based on what you can reasonably interpret.
• Some transcripts have gaps or missing sections. If a phase appears to be missing from the transcript entirely (e.g., no pricing discussion visible), note "not captured in transcript" and score 0 — do not guess.
• Timestamps are in MM:SS format. Use them as provided. Never fabricate a timestamp — if you can't find the exact moment, use the nearest visible timestamp with a note.

─── SPICED & BANT ───

SPICED is the primary discovery framework. Score each element based on whether the AE actively uncovered the information through questioning — not whether the prospect volunteered it unprompted. The AE's job is to pull these out deliberately.

• "strong" = AE asked targeted questions AND got clear answers
• "partial" = topic came up but AE didn't dig deep enough or prospect's answer was vague and AE didn't press
• "missing" = never addressed

Impact (I) is the hardest element and the most commonly missed. "What's the cost of not solving this?" or "How does that affect revenue?" — if the AE didn't quantify the pain, Impact is "missing" regardless of how good the rest of discovery was.

BANT is evaluated separately from the 100-point score. Be equally rigorous — "we can work with your budget" is NOT the same as confirming a number.

─── OUTPUT ───

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. No explanatory text. Just the JSON object as specified in the scoring prompt.`;

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
   Score each SPICED element independently:
   - S — Situation (5 pts): What is the prospect's current setup, team size, context?
   - P — Pain (5 pts): Did the AE uncover a specific, named business problem?
   - I — Impact (5 pts): Did the AE quantify what the pain costs the business? (This is the most commonly missed step.)
   - C — Critical Event (5 pts): Is there a deadline or event that creates urgency?
   - E — Decision (5 pts): Did the AE map the decision process, timeline, and stakeholders?

PHASE 3 — PRESENTATION (22 pts)
4. Smooth & professional (4 pts)
   - Green: Fluid transitions, no filler phrases or awkward gaps
   - Red: Repetitive, jargon-heavy, or disjointed

5. Talk ratio (6 pts)
   - Green: No unbroken AE stretch >90 seconds, prospect spoke ~40% of demo section
   - Red: Multiple 3+ minute monologues without check-ins

6. Personalization (8 pts)
   - Green: Features tied directly to the prospect's stated pain points
   - Red: Generic feature walkthrough with no connection to discovery

7. Tie-downs / micro-closes (4 pts)
   - Green: Regular value checks between sections ("Does that make sense for your team?")
   - Red: No pauses for agreement or reaction

PHASE 4 — PRICING & OBJECTION HANDLING (28 pts)
8. Value summary before price (8 pts)
   - Green: Full recap of benefits before the number is mentioned
   - Red: Price dropped without context

9. Simple pricing (6 pts)
   - Green: One option stated, then silence — let the prospect respond
   - Red: Multiple options presented simultaneously, or AE filled silence

10. No premature discount (2 pts)
    - Green (2): No discount offered, or only after full ECIR
    - Red (0): Discount offered before objection fully explored — AUTO RED FLAG

11. ECIR objection handling (12 pts)
    Score per objection, then average. Each objection should follow:
    - E — Empathize (3 pts): Genuinely acknowledged the concern before defending
    - C — Clarify (3 pts): Asked a question to fully understand the objection
    - I — Isolate (3 pts): Confirmed this was the only/real concern
    - R — Respond (3 pts): Answered directly rather than deflecting or discounting
    If no objections were raised, score 0/12 and note "no objections encountered."

PHASE 5 — CLOSE & NEXT STEPS (12 pts)
12. SVC Close — Summarize Value → Surface Concern → Commit (10 pts total)
    This is the closing framework. Score each step independently:
    - S — Summarize Value (4 pts): Did the AE recap 2-3 specific benefits tied to the prospect's stated pain BEFORE asking for the close? This is NOT a feature recap — it must reference what the prospect said they cared about during discovery.
      - Strong (3-4): Clear value summary tying product back to their specific pain points from discovery
      - Partial (1-2): Mentioned some benefits but generic — not tied to what the prospect said
      - Missing (0): Jumped straight to pricing or "so, what do you think?"
    - V — Surface Concern (3 pts): Did the AE proactively ask "What would stop you from moving forward today?" or similar — giving the prospect a chance to voice remaining hesitation BEFORE the commitment ask?
      - Strong (3): Proactive question that surfaced a real concern or confirmed none exist
      - Partial (1-2): Asked vaguely ("any questions?") without directly addressing hesitation
      - Missing (0): Skipped straight to asking for the sale without checking for blockers
    - C — Commit (3 pts): Did the AE make a clear, direct ask for a commitment — sign today, start a trial, schedule an onboarding call? "I'll send a proposal" is NOT a commitment ask.
      - Strong (3): Direct, specific ask ("Can we get you started on the annual plan today?")
      - Partial (1-2): Soft close ("What are you thinking?") without a specific ask
      - Missing (0): No close attempt — defaulted to follow-up email

    If the prospect closed themselves (said "let's do it" before the AE asked), still evaluate whether the AE set up the close properly with S and V. The AE gets full Commit points but should still be graded on the setup.

13. Scheduled follow-up (2 pts)
    - Green: Specific date and time confirmed
    - Red: Vague "I'll send you something"

BANT QUALIFICATION (evaluated separately — does not affect the 100-point score)
Evaluate each BANT element independently. Score 0-5 per element.
- B — Budget (5 pts): Did the AE establish whether the prospect has budget allocated or can secure it?
  - Strong (4-5): Budget explicitly discussed, amount or range confirmed
  - Partial (2-3): Budget mentioned but not confirmed, or prospect deflected and AE didn't press
  - Missing (0-1): No budget discussion at all
- A — Authority (5 pts): Did the AE confirm who the decision-maker is and whether they're on the call?
  - Strong (4-5): Decision-maker identified, their role in the process is clear
  - Partial (2-3): Asked about decision process but didn't pin down the authority
  - Missing (0-1): No discussion of who makes the buying decision
- N — Need (5 pts): Did the AE uncover a clear, urgent business need the product solves?
  - Strong (4-5): Specific business need articulated and tied to the product
  - Partial (2-3): General need discussed but not specific or not tied to product
  - Missing (0-1): No clear need established
- T — Timeline (5 pts): Did the AE establish a concrete timeline or deadline for making a decision?
  - Strong (4-5): Specific date, event, or deadline driving urgency
  - Partial (2-3): Vague timeframe like "soon" or "next quarter" without commitment
  - Missing (0-1): No timeline discussed

BONUS FLAGS (no points — always evaluate)
- Enthusiasm: Was energy consistently high and genuine throughout?
- Unprofessional language: Any slang, excessive filler words, or cringeworthy phrasing?
- Premature disqualification: Did the AE write off this prospect too early?

─── OUTPUT FORMAT ───

Return ONLY this JSON structure. No other text.

{
  "score": <number 0-100>,
  "rag": "green" | "yellow" | "red",
  "verdict": "<One sentence plain-English summary of the call — what went right and what didn't>",
  "phases": {
    "preCall": {
      "score": <number>,
      "maxPoints": 6,
      "criteria": {
        "research": {
          "score": <number>,
          "maxPoints": 6,
          "rag": "g" | "y" | "r",
          "feedback": "<2-3 sentences from coaching perspective with specific observations>",
          "timestamps": ["MM:SS"]
        }
      }
    },
    "discovery": {
      "score": <number>,
      "maxPoints": 32,
      "criteria": {
        "agenda": {
          "score": <number>,
          "maxPoints": 7,
          "rag": "g" | "y" | "r",
          "feedback": "<coaching feedback>",
          "timestamps": ["MM:SS"]
        },
        "spiced": {
          "score": <number>,
          "maxPoints": 25
        }
      }
    },
    "presentation": {
      "score": <number>,
      "maxPoints": 22,
      "criteria": {
        "smooth": { "score": <number>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "talkRatio": { "score": <number>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "personalization": { "score": <number>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "tieDowns": { "score": <number>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }
      }
    },
    "pricing": {
      "score": <number>,
      "maxPoints": 28,
      "criteria": {
        "valueSummary": { "score": <number>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "simplePricing": { "score": <number>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "noDiscount": { "score": <number>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
        "ecir": {
          "score": <number>,
          "maxPoints": 12,
          "rag": "g"|"y"|"r",
          "feedback": "<...>",
          "timestamps": ["MM:SS"],
          "objectionsHandled": <number>,
          "objections": [
            {
              "topic": "<what the objection was about>",
              "timestamp": "MM:SS",
              "empathize": true|false,
              "clarify": true|false,
              "isolate": true|false,
              "respond": true|false
            }
          ]
        }
      }
    },
    "closing": {
      "score": <number>,
      "maxPoints": 12,
      "criteria": {
        "svc": {
          "score": <number>,
          "maxPoints": 10,
          "rag": "g"|"y"|"r",
          "feedback": "<coaching feedback on the overall close attempt>",
          "timestamps": ["MM:SS"]
        },
        "followUp": { "score": <number>, "maxPoints": 2, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }
      }
    }
  },
  "spiced": {
    "s": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS-MM:SS"] },
    "p": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS-MM:SS"] },
    "i": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS-MM:SS"] },
    "c": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS-MM:SS"] },
    "e": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS-MM:SS"] }
  },
  "bant": {
    "b": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "a": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "n": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "t": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }
  },
  "svc": {
    "summarize": { "score": <0-4>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "surface": { "score": <0-3>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "commit": { "score": <0-3>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
  },
  "wins": [
    "<Specific win #1 with timestamp — written as a coaching highlight>",
    "<Specific win #2 with timestamp>",
    "<Specific win #3 with timestamp>"
  ],
  "fixes": [
    "<Priority fix #1 — written as an instruction, not an observation>",
    "<Priority fix #2>"
  ],
  "flags": {
    "enthusiasm": { "detected": true|false, "note": "<brief note if detected>" },
    "unprofessionalLanguage": { "detected": true|false, "note": "<brief note if detected, with timestamp>" },
    "prematureDisqualification": { "detected": true|false, "note": "<brief note if detected, with timestamp>" }
  },
  "quoteOfTheCall": {
    "text": "<Exact quote from the transcript that best illustrates the biggest coaching moment — win or fix>",
    "timestamp": "MM:SS",
    "context": "<Why this quote matters>"
  }
}

─── TRANSCRIPT ───

${transcriptText}`;
}

async function scoreTranscript({ transcriptText, repName, companyName, durationMinutes }) {
  const prompt = buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);

  console.log(`[scoring] Sending transcript to Claude (${CONFIG.claudeModel})...`);
  console.log(`[scoring] Transcript length: ${transcriptText.length} chars`);

  const response = await client.messages.create({
    model: CONFIG.claudeModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });

  const rawText = response.content[0].text;
  console.log(`[scoring] Claude responded (${response.usage.input_tokens} in, ${response.usage.output_tokens} out)`);

  // Parse JSON — Claude should return pure JSON, but strip any accidental markdown fences
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let scorecard;
  try {
    scorecard = JSON.parse(cleaned);
  } catch (err) {
    console.error("[scoring] Failed to parse Claude response as JSON:");
    console.error(rawText.substring(0, 500));
    throw new Error(`Claude returned invalid JSON: ${err.message}`);
  }

  // Basic validation
  if (typeof scorecard.score !== "number" || !scorecard.rag || !scorecard.verdict) {
    throw new Error("Claude response missing required fields (score, rag, verdict)");
  }

  console.log(`[scoring] Result: ${scorecard.score}/100 (${scorecard.rag})`);
  return scorecard;
}

module.exports = { scoreTranscript };
