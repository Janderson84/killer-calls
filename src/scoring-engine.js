const Anthropic = require("@anthropic-ai/sdk");
const { CONFIG } = require("./constants");

// ─── Scoring Engine ──────────────────────────────────────────────
// Sends a transcript to Claude with the full 14-criterion rubric.
// Returns a structured JSON scorecard.

const client = new Anthropic();

// The scoring prompt — this is the brain of the entire system.
// It encodes the full rubric from the plan doc, asks for structured
// JSON output, and instructs Claude to reference specific timestamps.
const SYSTEM_PROMPT = `You are an expert sales call analyst for SalesCloser.ai. You score demo calls against a strict 14-criterion rubric using the SPICED, BANT, and ECIR frameworks. You write from a third-person coaching perspective — objective, specific, and actionable.

You always reference timestamps from the transcript. You never make up timestamps — if you can't find evidence for a criterion, say so.

Your output is ONLY valid JSON. No prose before or after. No markdown code fences. Just the JSON object.`;

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
12. Pushed to close (10 pts)
    - Green: Genuine close attempt on the call before scheduling follow-up
    - Red: Jumped straight to "I'll send a follow-up" without trying to close

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
        "pushToClose": { "score": <number>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] },
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
