import { config } from "dotenv";
config({ path: ".env.rescore" });

import { neon } from "@neondatabase/serverless";
import Anthropic from "@anthropic-ai/sdk";

const sql = neon(process.env.DATABASE_URL);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";

const AE_BY_EMAIL = {
  "pedro.c@salescloser.ai": "Pedro Cavagnari",
  "edgar.a@salescloser.ai": "Edgar Arana",
  "marc.b@salescloser.ai": "Marc James Beauchamp",
  "zachary.o@salescloser.ai": "Zachary Obando",
  "alfred.d@salescloser.ai": "Alfred Du",
  "vanessa.f@salescloser.ai": "Vanessa Fortune",
  "marysol.o@salescloser.ai": "Marysol Ortega",
  "gleidson.r@salescloser.ai": "Gleidson Rocha",
  "david.m@salescloser.ai": "David Morawietz",
};

const SCORING_SYSTEM_PROMPT = `You are an expert sales call analyst and coaching system for SalesCloser.ai. Your role is to evaluate AI demo sales calls with rigor, precision, and a coaching mindset — the goal is rep improvement, not punishment.

## Your Identity
You score calls against a strict 14-criterion, 100-point rubric. You write from a third-person coaching perspective — objective, specific, and actionable. Your feedback should be the kind a great sales manager would give after listening to the call themselves.

## Frameworks You Evaluate

**SPICED** (Discovery framework — 5 pts each, 25 pts total):
- S — Situation: Current setup, team size, context
- P — Pain: Specific, named business problem (not symptoms)
- I — Impact: Quantified cost of the pain — this is the most commonly missed step
- C — Critical Event: Deadline or trigger that creates urgency
- E — Decision: Decision process, timeline, and stakeholders mapped

**Close Execution** (3-step close framework — evaluated by detected style):
Detect which close style the AE used (consultative, assumptive, urgency, or none) and evaluate 3 steps:
- Setup: Did the AE set up the close properly (e.g., value summary, trial close, urgency framing)?
- Bridge: Did the AE transition smoothly from presentation to close (not abrupt or awkward)?
- Ask: Did the AE make a clear, direct close ask (not wishy-washy or passive)?
Each step is strong/partial/missing with a label describing what the step was, feedback, and timestamps.

**ECIR** (Objection handling framework — 12 pts total):
- E — Empathize: Genuinely acknowledge before defending
- C — Clarify: Ask a question to fully understand the objection
- I — Isolate: Confirm this is the only/real blocker
- R — Respond: Answer directly, don't deflect or pre-discount

**BANT** (Qualification — evaluated separately, does NOT affect the 100-pt score):
- B — Budget: Is budget allocated or securable?
- A — Authority: Is the decision-maker identified and present?
- N — Need: Is there a clear, urgent, product-relevant need?
- T — Timeline: Is there a concrete decision deadline?

## Scoring Philosophy
- Score what you observe, not what you hope was there. If evidence is absent, score it low.
- Impact (SPICED-I) is the single highest-leverage coaching point — flag every miss.
- ECIR: If the AE jumped to discount or defense before completing E→C→I, that's a red flag regardless of outcome.
- Talk ratio: Long AE monologues without check-ins are a consistent problem — be specific about which timestamps show this.
- Timestamps are mandatory evidence. Never fabricate them. If you can't find evidence for a criterion, say so explicitly in the feedback.

## Output Rules
- Your output is ONLY valid JSON. No prose before or after. No markdown code fences. Just the raw JSON object.
- Every feedback field must be 2–3 sentences minimum, written as coaching instruction ("Pedro should have asked..." not "the rep failed to...").
- Wins should highlight specific moments by timestamp — not generic praise.
- Fixes should be actionable instructions for the next call, not observations about this one.
- closingTips should be 3-5 specific, actionable closing techniques tailored to what happened (or didn't happen) in this call. Reference the prospect's situation, the objections raised, and the close style used. Each tip should be a concrete sentence the AE could say or a specific tactic they could deploy next time — not generic advice.
- quoteOfTheCall should capture the single most instructive moment — a win OR a miss — with enough context to be useful in a team review.`;

function buildPrompt(transcriptText, repName, companyName, durationMinutes) {
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
  "close": {
    "style": "consultative"|"assumptive"|"urgency"|"none",
    "styleName": "<human-readable style name, e.g. 'Consultative Close', 'Assumptive Close', 'Urgency Close'>",
    "setup": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<what the setup step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "bridge": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<what the bridge step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "ask": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<what the ask step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
  },
  "closingTips": ["<tip #1 — specific tactic or phrase the AE should use to close this prospect>", "<tip #2>", "<tip #3>", "<tip #4>", "<tip #5>"],
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

async function fetchTranscript(meetingId) {
  const resp = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}`,
    },
    body: JSON.stringify({
      query: `query Transcript($transcriptId: String!) {
        transcript(id: $transcriptId) {
          id title date duration
          speakers { id name }
          sentences { index text raw_text start_time end_time speaker_id speaker_name }
          organizer_email participants
        }
      }`,
      variables: { transcriptId: meetingId },
    }),
  });

  if (!resp.ok) throw new Error(`Fireflies API ${resp.status}`);
  const json = await resp.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const t = json.data.transcript;
  if (!t) throw new Error(`No transcript found: ${meetingId}`);

  const transcriptText = (t.sentences || [])
    .map((s) => {
      const mins = Math.floor((s.start_time || 0) / 60);
      const secs = Math.floor((s.start_time || 0) % 60);
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      return `[${ts}] ${s.speaker_name || "Unknown"}: ${s.text || s.raw_text || ""}`;
    })
    .join("\n");

  const organizerEmail = (t.organizer_email || "").toLowerCase();
  const knownRep = AE_BY_EMAIL[organizerEmail];
  let companyName = "Unknown Company";

  if (knownRep) {
    const title = t.title || "";
    const scMatch = title.match(/^SalesCloser AI meeting\s*(?:with\s*)?(.+?)(?:\s*[-–—]\s*.+)?$/i);
    if (scMatch) {
      companyName = scMatch[1].trim();
    } else {
      const parts = title.split(/\s+and\s+/i);
      if (parts.length === 2) {
        const a = parts[0].trim();
        const b = parts[1].trim();
        const aIsRep = a.toLowerCase().includes(knownRep.split(" ")[0].toLowerCase());
        companyName = aIsRep ? b : a;
      } else {
        const arrowMatch = title.match(/^(.+?)\s*(?:<>|→|->|with)\s*(.+)$/i);
        if (arrowMatch) {
          const a = arrowMatch[1].trim();
          const b = arrowMatch[2].trim();
          const aIsRep = a.toLowerCase().includes(knownRep.split(" ")[0].toLowerCase());
          companyName = aIsRep ? b : a;
        } else {
          companyName = title;
        }
      }
    }
  }

  return { transcriptText, companyName };
}

async function scoreCall(prompt) {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: SCORING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let cleaned = text.trim();
  if (cleaned.includes("```")) {
    const match = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) cleaned = match[1];
  }
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  return JSON.parse(cleaned);
}

async function main() {
  // Get the 10 most recent scorecards
  const rows = await sql`
    SELECT id, meeting_id, rep_name, company_name, duration_minutes
    FROM scorecards
    ORDER BY created_at DESC
    LIMIT 10
  `;

  console.log(`Found ${rows.length} calls to re-score\n`);

  for (const row of rows) {
    console.log(`--- ${row.rep_name} → ${row.company_name} (${row.id}) ---`);

    try {
      // Fetch transcript from Fireflies
      console.log("  Fetching transcript...");
      const { transcriptText, companyName } = await fetchTranscript(row.meeting_id);

      // Build prompt and score
      console.log("  Scoring via Claude...");
      const prompt = buildPrompt(transcriptText, row.rep_name, companyName || row.company_name, row.duration_minutes);
      const scorecard = await scoreCall(prompt);

      console.log(`  New score: ${scorecard.score}/100 (${scorecard.rag})`);
      console.log(`  Close style: ${scorecard.close?.styleName || "none"}`);
      console.log(`  Closing tips: ${scorecard.closingTips?.length || 0}`);

      // Update the database
      await sql`
        UPDATE scorecards SET
          score = ${scorecard.score},
          rag = ${scorecard.rag},
          verdict = ${scorecard.verdict},
          score_pre_call = ${scorecard.phases?.preCall?.score || null},
          score_discovery = ${scorecard.phases?.discovery?.score || null},
          score_presentation = ${scorecard.phases?.presentation?.score || null},
          score_pricing = ${scorecard.phases?.pricing?.score || null},
          score_closing = ${scorecard.phases?.closing?.score || null},
          spiced_s = ${scorecard.spiced?.s?.status || null},
          spiced_p = ${scorecard.spiced?.p?.status || null},
          spiced_i = ${scorecard.spiced?.i?.status || null},
          spiced_c = ${scorecard.spiced?.c?.status || null},
          spiced_e = ${scorecard.spiced?.e?.status || null},
          bant_b = ${scorecard.bant?.b?.status || null},
          bant_a = ${scorecard.bant?.a?.status || null},
          bant_n = ${scorecard.bant?.n?.status || null},
          bant_t = ${scorecard.bant?.t?.status || null},
          close_style = ${scorecard.close?.style || null},
          close_setup = ${scorecard.close?.setup?.status || null},
          close_bridge = ${scorecard.close?.bridge?.status || null},
          close_ask = ${scorecard.close?.ask?.status || null},
          scorecard_json = ${JSON.stringify(scorecard)}
        WHERE id = ${row.id}
      `;

      console.log("  Updated!\n");
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
    }

    // Delay between calls to avoid rate limits
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("Done!");
}

main().catch(console.error);
