import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { WebClient } from "@slack/web-api";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ─────────────────────────────────────────────────────
const AE_EMAILS = [
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "zachary.o@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "marysol.o@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
];

const AE_SLACK_IDS: Record<string, string> = {
  "Pedro Cavagnari": "U0A7HQWP3GU",
  "Edgar Arana": "U0A6YPUEB7H",
  "Marc James Beauchamp": "U0A7T59MFCZ",
  "Zachary Obando": "U0A7C69UHK8",
  "Alfred Du": "U0A7T58JVHP",
  "Vanessa Fortune": "U0A7T58H2MP",
  "Marysol Ortega": "U0A6YPVA53R",
  "Gleidson Rocha": "U0A88GBQQQ0",
  "David Morawietz": "U0A89DVTWQ1",
};

const AE_BY_EMAIL: Record<string, string> = {
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

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";
const MIN_DURATION_MINUTES = 20;

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s+call|second\s+call|check[\s-]?in/i;

const AE_EMAIL_SET = new Set(AE_EMAILS.map((e) => e.toLowerCase()));

// ─── Scoring system prompt ──────────────────────────────────────
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
- MANDATORY: You MUST include ALL top-level keys in the JSON output: score, rag, verdict, phases, spiced, bant, close, closingTips, wins, fixes, flags, quoteOfTheCall. The "close" object is REQUIRED — never omit it. If no close was attempted, use style: "none".
- Every feedback field must be 2–3 sentences minimum, written as coaching instruction ("Pedro should have asked..." not "the rep failed to...").
- Wins should highlight specific moments by timestamp — not generic praise.
- Fixes should be actionable instructions for the next call, not observations about this one.
- closingTips should be 3-5 specific, actionable closing techniques tailored to what happened (or didn't happen) in this call. Reference the prospect's situation, the objections raised, and the close style used. Each tip should be a concrete sentence the AE could say or a specific tactic they could deploy next time — not generic advice.
- quoteOfTheCall should capture the single most instructive moment — a win OR a miss — with enough context to be useful in a team review.`;

// ─── Followup scoring system prompt ──────────────────────────────
const FOLLOWUP_SCORING_SYSTEM_PROMPT = `You are an expert sales call analyst and coaching system for SalesCloser.ai. Your role is to evaluate FOLLOW-UP sales calls — calls where the AE has already met this prospect before.

## Key Difference from Discovery Calls
Follow-up calls should NOT be penalized for skipping full discovery. The AE already uncovered situation/pain/impact on the first call. Instead, evaluate whether the AE effectively advanced the deal toward close by resolving objections, continuing the presentation, handling pricing, and executing a strong close.

## Frameworks You Evaluate

**ECIR** (Objection handling framework — critical for followups):
- E — Empathize: Genuinely acknowledge before defending
- C — Clarify: Ask a question to fully understand the objection
- I — Isolate: Confirm this is the only/real blocker
- R — Respond: Answer directly, don't deflect or pre-discount

**Close Execution** (3-step close framework — the main event on followups):
Detect which close style the AE used (consultative, assumptive, urgency, or none) and evaluate 3 steps:
- Setup: Did the AE set up the close properly?
- Bridge: Did the AE transition smoothly from presentation to close?
- Ask: Did the AE make a clear, direct close ask?

**BANT** (Qualification — evaluated separately, does NOT affect the 100-pt score):
- B — Budget, A — Authority, N — Need, T — Timeline

## Scoring Philosophy
- Follow-up calls are about ADVANCING and CLOSING, not discovering.
- If a prior call context is provided, credit the AE for closing gaps from the first call.
- Score what you observe. If evidence is absent, score it low.
- Timestamps are mandatory evidence. Never fabricate them.

## Output Rules
- Your output is ONLY valid JSON. No prose before or after. No markdown code fences.
- Every feedback field must be 2–3 sentences minimum, written as coaching instruction.
- Wins should highlight specific moments by timestamp.
- Fixes should be actionable instructions for the next call.
- closingTips should be 3-5 specific, actionable closing techniques.
- quoteOfTheCall should capture the single most instructive moment.`;

// ─── Vercel Cron auth ───────────────────────────────────────────
export const maxDuration = 300; // 5 minutes max

export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];
  const ts = new Date().toISOString();
  log.push(`[${ts}] Polling Fireflies for new calls...`);

  try {
    // 1. Get already-scored + skipped meeting IDs
    const scoredRows = await sql`SELECT meeting_id FROM scorecards`;
    const skippedRows = await sql`SELECT meeting_id FROM skipped_meetings`;
    const processed = new Set([
      ...scoredRows.map((r) => r.meeting_id),
      ...skippedRows.map((r) => r.meeting_id),
    ]);
    log.push(`  ${scoredRows.length} scored, ${skippedRows.length} skipped`);

    // 2. Fetch recent transcripts for each AE
    const newMeetings: { id: string; title: string; email: string }[] = [];
    for (const email of AE_EMAILS) {
      try {
        const transcripts = await fetchRecentByOrganizer(email);
        for (const t of transcripts) {
          if (!processed.has(t.id)) {
            newMeetings.push({ id: t.id, title: t.title, email });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.push(`  Error fetching for ${email}: ${msg}`);
      }
    }

    if (newMeetings.length === 0) {
      log.push("  No new calls found. All up to date.");
      return NextResponse.json({ status: "ok", message: "No new calls", log });
    }

    log.push(`  Found ${newMeetings.length} new call(s) to score`);

    // 3. Process each new call
    // Skips are instant; limit to 2 actual scores per run to stay within Vercel timeout
    const MAX_SCORED_PER_RUN = 2;
    const results: { meetingId: string; score?: number; rag?: string; rep?: string; skipped?: boolean }[] = [];
    let scoredCount = 0;

    for (const meeting of newMeetings) {
      if (scoredCount >= MAX_SCORED_PER_RUN) break;
      try {
        const result = await processOne(meeting.id, sql, log);
        results.push(result);
        if (!result.skipped) scoredCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.push(`  FAILED ${meeting.id}: ${msg}`);
      }
    }

    const scored = results.filter((r) => !r.skipped);
    const skipped = results.filter((r) => r.skipped);
    const remaining = newMeetings.length - results.length;
    log.push(`  Done: ${scored.length} scored, ${skipped.length} skipped`);
    if (remaining > 0) {
      log.push(`  ${remaining} remaining — will process next cycle`);
    }

    return NextResponse.json({ status: "ok", scored: scored.length, skipped: skipped.length, log });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`Fatal: ${msg}`);
    return NextResponse.json({ status: "error", error: msg, log }, { status: 500 });
  }
}

// ─── Fetch recent transcripts from Fireflies ────────────────────
async function fetchRecentByOrganizer(email: string) {
  const resp = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}`,
    },
    body: JSON.stringify({
      query: `query RecentTranscripts($organizerEmail: String) {
        transcripts(organizer_email: $organizerEmail, limit: 10) {
          id title date organizer_email
        }
      }`,
      variables: { organizerEmail: email },
    }),
  });

  if (!resp.ok) throw new Error(`Fireflies API ${resp.status}`);
  const json = await resp.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.transcripts || [];
}

// ─── Fetch full transcript ──────────────────────────────────────
async function fetchTranscript(meetingId: string) {
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
    .map((s: { start_time?: number; speaker_name?: string; text?: string; raw_text?: string }) => {
      const mins = Math.floor((s.start_time || 0) / 60);
      const secs = Math.floor((s.start_time || 0) % 60);
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      return `[${ts}] ${s.speaker_name || "Unknown"}: ${s.text || s.raw_text || ""}`;
    })
    .join("\n");

  const organizerEmail = (t.organizer_email || "").toLowerCase();
  const knownRep = AE_BY_EMAIL[organizerEmail];
  let repName = knownRep || "Unknown Rep";
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

  // Extract prospect email from participants (filter out AE emails)
  const participants: string[] = Array.isArray(t.participants) ? t.participants : [];
  const prospectEmail = participants
    .map((e: string) => e.toLowerCase().trim())
    .find((e: string) => e.includes("@") && !AE_EMAIL_SET.has(e)) || null;

  return {
    meetingId: t.id,
    title: t.title,
    date: t.date
      ? new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Unknown date",
    durationMinutes: t.duration ? Math.round(t.duration) : null,
    repName,
    companyName,
    transcriptText,
    speakerCount: t.speakers ? t.speakers.length : 0,
    prospectEmail,
  };
}

// ─── Score via Anthropic API ────────────────────────────────────
async function scoreCall(prompt: string, systemPrompt: string = SCORING_SYSTEM_PROMPT) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
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

  const scorecard = JSON.parse(cleaned);
  if (typeof scorecard.score !== "number" || !scorecard.rag) {
    throw new Error("Anthropic response missing required fields");
  }

  // Ensure close object always exists — model sometimes omits it
  if (!scorecard.close) {
    scorecard.close = {
      style: "none",
      styleName: "No Close Detected",
      setup: { score: 0, status: "missing", label: "No setup detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      bridge: { score: 0, status: "missing", label: "No bridge detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      ask: { score: 0, status: "missing", label: "No ask detected", feedback: "No close execution was detected in this call.", timestamps: [] },
    };
  }
  return scorecard;
}

// ─── Build scoring prompt ───────────────────────────────────────
function buildPrompt(transcriptText: string, repName: string, companyName: string, durationMinutes: number | null) {
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

// ─── Build followup scoring prompt ──────────────────────────────
function buildFollowupPrompt(
  transcriptText: string,
  repName: string,
  companyName: string,
  durationMinutes: number | null,
  priorCallContext: string | null
) {
  const priorBlock = priorCallContext
    ? `\n─── PRIOR CALL CONTEXT ───\nThis is a follow-up call. Here is what happened on the first call:\n${priorCallContext}\n\nCredit the AE for closing gaps from the first call. For example, if Budget was "missing" in call 1 but addressed here, that's a strong BANT-B.\n`
    : "";

  return `You are an expert sales call analyst. Score this FOLLOW-UP call against a closing-focused rubric. This is NOT a discovery call — the AE has already met this prospect. Your output is ONLY valid JSON — no prose, no markdown fences.

REP: ${repName}
PROSPECT: ${companyName}
DURATION: ${durationMinutes || "unknown"} minutes
CALL TYPE: Follow-up
${priorBlock}
─── SCORING RUBRIC (100 points total) ───

PHASE 1 — RECAP & CONTEXT SETTING (10 pts)
1. Recap (10 pts) - Green (8-10): AE summarized prior call, confirmed understanding, set agenda for this call - Yellow (4-7): Brief recap but missed key items - Red (0-3): No recap, jumped straight in

PHASE 2 — OBJECTION RESOLUTION (25 pts)
2. ECIR objection handling (25 pts) - Evaluate each objection using Empathize→Clarify→Isolate→Respond
   Green (20-25): All objections handled with full ECIR flow
   Yellow (10-19): Some ECIR steps missed
   Red (0-9): Jumped to defense/discount without ECIR

PHASE 3 — PRESENTATION CONTINUATION (15 pts)
3. Continued demo/presentation (15 pts) - Green (12-15): Picked up where left off, tied to prospect's specific needs - Yellow (7-11): Generic continuation - Red (0-6): No continuation or irrelevant

PHASE 4 — PRICING & NEGOTIATION (20 pts)
4. Value summary before price (8 pts) - Green: Summarized value before discussing price
5. Pricing discussion (6 pts) - Green: Clear, confident pricing
6. No premature discount (2 pts) - Auto red if discount before ECIR
7. Negotiation handling (4 pts) - Green: Held firm on value, creative packaging

PHASE 5 — CLOSE EXECUTION (30 pts) — THE MAIN EVENT
8. Close setup (10 pts) - Green: Built urgency, summarized value, trial-closed
9. Close bridge (8 pts) - Green: Smooth transition from presentation to ask
10. Close ask (12 pts) - Green: Clear, direct, confident close ask with specific next step

BANT QUALIFICATION (evaluated separately — does NOT affect the 100-point score)
Evaluate each BANT element independently. Score 0-5 per element.
- B — Budget (5 pts), A — Authority (5 pts), N — Need (5 pts), T — Timeline (5 pts)

BONUS FLAGS: Enthusiasm, Unprofessional language, Premature disqualification

─── OUTPUT FORMAT ───
Return ONLY this JSON:
{
  "score": <0-100>,
  "rag": "green"|"yellow"|"red",
  "verdict": "<one sentence summary>",
  "phases": {
    "preCall": { "score": <n>, "maxPoints": 10, "criteria": { "recap": { "score": <n>, "maxPoints": 10, "rag": "g"|"y"|"r", "feedback": "<2-3 sentences>", "timestamps": ["MM:SS"] } } },
    "discovery": { "score": <n>, "maxPoints": 25, "criteria": { "ecir": { "score": <n>, "maxPoints": 25, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"], "objectionsHandled": <n>, "objections": [{ "topic": "<...>", "timestamp": "MM:SS", "empathize": true|false, "clarify": true|false, "isolate": true|false, "respond": true|false }] } } },
    "presentation": { "score": <n>, "maxPoints": 15, "criteria": { "continuation": { "score": <n>, "maxPoints": 15, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "pricing": { "score": <n>, "maxPoints": 20, "criteria": { "valueSummary": { "score": <n>, "maxPoints": 8, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "simplePricing": { "score": <n>, "maxPoints": 6, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "noDiscount": { "score": <n>, "maxPoints": 2, "rag": "g"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] }, "negotiation": { "score": <n>, "maxPoints": 4, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } },
    "closing": { "score": <n>, "maxPoints": 30, "criteria": { "pushToClose": { "score": <n>, "maxPoints": 30, "rag": "g"|"y"|"r", "feedback": "<...>", "timestamps": ["MM:SS"] } } }
  },
  "spiced": {
    "s": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] },
    "p": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] },
    "i": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] },
    "c": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] },
    "e": { "score": 0, "status": "missing", "feedback": "Not evaluated on follow-up calls.", "timestamps": [] }
  },
  "bant": {
    "b": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "a": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "n": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] },
    "t": { "score": <0-5>, "status": "strong"|"partial"|"missing", "feedback": "<...>", "timestamps": ["MM:SS"] }
  },
  "close": {
    "style": "consultative"|"assumptive"|"urgency"|"none",
    "styleName": "<human-readable style name>",
    "setup": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<what the setup step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "bridge": { "score": <0-3>, "status": "strong"|"partial"|"missing", "label": "<what the bridge step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] },
    "ask": { "score": <0-4>, "status": "strong"|"partial"|"missing", "label": "<what the ask step was>", "feedback": "<1-2 sentences>", "timestamps": ["MM:SS"] }
  },
  "closingTips": ["<tip #1>", "<tip #2>", "<tip #3>", "<tip #4>", "<tip #5>"],
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

// ─── Followup detection ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectFollowup(
  sql: any,
  repName: string,
  companyName: string,
  prospectEmail: string | null,
  title: string
): Promise<{ isFollowup: boolean; priorCallContext: string | null }> {
  // 1. Check by prospect email (most reliable)
  if (prospectEmail) {
    const priorByEmail = await sql`
      SELECT id, score, rag, verdict, company_name,
             spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
             bant_b, bant_a, bant_n, bant_t,
             scorecard_json
      FROM scorecards
      WHERE prospect_email = ${prospectEmail} AND rep_name = ${repName}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (priorByEmail.length > 0) {
      return { isFollowup: true, priorCallContext: buildPriorContext(priorByEmail[0]) };
    }
  }

  // 2. Check by company name
  const priorByCompany = await sql`
    SELECT id, score, rag, verdict, company_name,
           spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
           bant_b, bant_a, bant_n, bant_t,
           scorecard_json
    FROM scorecards
    WHERE company_name = ${companyName} AND rep_name = ${repName}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (priorByCompany.length > 0) {
    return { isFollowup: true, priorCallContext: buildPriorContext(priorByCompany[0]) };
  }

  // 3. Check by title pattern
  if (FOLLOWUP_TITLE_PATTERNS.test(title || "")) {
    return { isFollowup: true, priorCallContext: null };
  }

  return { isFollowup: false, priorCallContext: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPriorContext(row: any): string {
  const sc = typeof row.scorecard_json === "string" ? JSON.parse(row.scorecard_json) : row.scorecard_json;
  const lines: string[] = [];
  lines.push(`Prior call score: ${row.score}/100 (${row.rag})`);
  lines.push(`Verdict: ${row.verdict}`);

  // SPICED statuses
  const spicedItems = ["s", "p", "i", "c", "e"].map((k) => {
    const status = row[`spiced_${k}`] || "missing";
    const word = k === "s" ? "Situation" : k === "p" ? "Pain" : k === "i" ? "Impact" : k === "c" ? "Critical Event" : "Decision";
    return `${word}: ${status}`;
  });
  lines.push(`SPICED: ${spicedItems.join(", ")}`);

  // BANT statuses
  const bantItems = ["b", "a", "n", "t"].map((k) => {
    const status = row[`bant_${k}`] || "missing";
    const word = k === "b" ? "Budget" : k === "a" ? "Authority" : k === "n" ? "Need" : "Timeline";
    return `${word}: ${status}`;
  });
  lines.push(`BANT: ${bantItems.join(", ")}`);

  // Top fixes from prior call
  if (sc?.fixes?.length > 0) {
    lines.push(`Top fixes from prior call:\n${sc.fixes.map((f: string) => `  - ${f}`).join("\n")}`);
  }

  return lines.join("\n");
}

// ─── Process one call ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOne(
  meetingId: string,
  sql: any,
  log: string[]
) {
  log.push(`  Fetching transcript ${meetingId}...`);
  const transcript = await fetchTranscript(meetingId);
  log.push(`  Got: "${transcript.title}" (${transcript.repName}, ${transcript.durationMinutes}m)`);

  // Skip short calls
  if (transcript.durationMinutes && transcript.durationMinutes < MIN_DURATION_MINUTES) {
    log.push(`  Skipped — ${transcript.durationMinutes}m < ${MIN_DURATION_MINUTES}m`);
    await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${meetingId}, ${"too short"}) ON CONFLICT DO NOTHING`;
    return { meetingId, skipped: true };
  }

  // Skip no-shows
  if (transcript.speakerCount < 2) {
    log.push(`  Skipped — ${transcript.speakerCount} speaker(s)`);
    await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${meetingId}, ${"no-show"}) ON CONFLICT DO NOTHING`;
    return { meetingId, skipped: true };
  }

  // Detect followup
  const { isFollowup, priorCallContext } = await detectFollowup(
    sql, transcript.repName, transcript.companyName, transcript.prospectEmail, transcript.title
  );
  const callType = isFollowup ? "followup" : "discovery";
  if (isFollowup) {
    log.push(`  Detected as FOLLOW-UP call${priorCallContext ? " (prior call found)" : " (title match)"}`);
  }

  // Score via Anthropic API
  log.push(`  Scoring via Claude (${callType})...`);
  const prompt = isFollowup
    ? buildFollowupPrompt(transcript.transcriptText, transcript.repName, transcript.companyName, transcript.durationMinutes, priorCallContext)
    : buildPrompt(transcript.transcriptText, transcript.repName, transcript.companyName, transcript.durationMinutes);
  const systemPrompt = isFollowup ? FOLLOWUP_SCORING_SYSTEM_PROMPT : SCORING_SYSTEM_PROMPT;
  const scorecard = await scoreCall(prompt, systemPrompt);
  log.push(`  Score: ${scorecard.score}/100 (${scorecard.rag})`);

  // Save to DB
  const repRows = await sql`SELECT id FROM reps WHERE name = ${transcript.repName} LIMIT 1`;
  let repId: string;
  if (repRows.length > 0) {
    repId = repRows[0].id;
  } else {
    const newRep = await sql`INSERT INTO reps (name) VALUES (${transcript.repName}) RETURNING id`;
    repId = newRep[0].id;
  }

  const inserted = await sql`
    INSERT INTO scorecards (
      rep_id, meeting_id, title, company_name, rep_name,
      call_date, duration_minutes,
      score, rag, verdict,
      score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
      spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
      bant_b, bant_a, bant_n, bant_t,
      close_style, close_setup, close_bridge, close_ask,
      call_type, prospect_email,
      scorecard_json
    ) VALUES (
      ${repId}, ${meetingId}, ${transcript.title}, ${transcript.companyName}, ${transcript.repName},
      ${transcript.date}, ${transcript.durationMinutes},
      ${scorecard.score}, ${scorecard.rag}, ${scorecard.verdict},
      ${scorecard.phases?.preCall?.score || null},
      ${scorecard.phases?.discovery?.score || null},
      ${scorecard.phases?.presentation?.score || null},
      ${scorecard.phases?.pricing?.score || null},
      ${scorecard.phases?.closing?.score || null},
      ${scorecard.spiced?.s?.status || null},
      ${scorecard.spiced?.p?.status || null},
      ${scorecard.spiced?.i?.status || null},
      ${scorecard.spiced?.c?.status || null},
      ${scorecard.spiced?.e?.status || null},
      ${scorecard.bant?.b?.status || null},
      ${scorecard.bant?.a?.status || null},
      ${scorecard.bant?.n?.status || null},
      ${scorecard.bant?.t?.status || null},
      ${scorecard.close?.style || null},
      ${scorecard.close?.setup?.status || null},
      ${scorecard.close?.bridge?.status || null},
      ${scorecard.close?.ask?.status || null},
      ${callType}, ${transcript.prospectEmail},
      ${JSON.stringify(scorecard)}
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      score = EXCLUDED.score, rag = EXCLUDED.rag, verdict = EXCLUDED.verdict,
      scorecard_json = EXCLUDED.scorecard_json,
      bant_b = EXCLUDED.bant_b, bant_a = EXCLUDED.bant_a,
      bant_n = EXCLUDED.bant_n, bant_t = EXCLUDED.bant_t,
      close_style = EXCLUDED.close_style, close_setup = EXCLUDED.close_setup,
      close_bridge = EXCLUDED.close_bridge, close_ask = EXCLUDED.close_ask,
      call_type = EXCLUDED.call_type, prospect_email = EXCLUDED.prospect_email
    RETURNING id`;

  const scorecardId = inserted[0].id;

  // Post to Slack
  try {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_REVIEWS;
    if (slackToken && channelId) {
      const slack = new WebClient(slackToken);
      const mention = AE_SLACK_IDS[transcript.repName]
        ? `<@${AE_SLACK_IDS[transcript.repName]}>`
        : transcript.repName;

      const ragEmoji = scorecard.rag === "green" ? "🟢" : scorecard.rag === "yellow" ? "🟡" : "🔴";
      const ragLabel = scorecard.score >= 80 ? "Green" : scorecard.score >= 60 ? "Yellow" : "Red";

      const spicedLine = ["s", "p", "i", "c", "e"]
        .map((el) => {
          const d = scorecard.spiced?.[el];
          const pip = d?.status === "strong" ? "✅" : d?.status === "partial" ? "🟡" : "🔴";
          return `${pip} ${el.toUpperCase()}`;
        })
        .join("   ");

      const url = process.env.APP_URL
        ? `${process.env.APP_URL.replace(/\/$/, "")}/calls/${scorecardId}`
        : null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bantLine = ["b", "a", "n", "t"]
        .map((el) => {
          const d = scorecard.bant?.[el];
          const pip = d?.status === "strong" ? "✅" : d?.status === "partial" ? "🟡" : "🔴";
          return `${pip} ${el.toUpperCase()}`;
        })
        .join("   ");

      const followupBadge = callType === "followup" ? " 🔄 Follow-up" : "";
      const blocks: any[] = [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${ragEmoji} *New Demo Scored | ${mention} → ${transcript.companyName}*${followupBadge}` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Score*\n${scorecard.score}/100 · ${ragLabel}` },
            { type: "mrkdwn", text: `*Duration*\n${transcript.durationMinutes || "?"} min` },
            { type: "mrkdwn", text: `*Date*\n${transcript.date}` },
            { type: "mrkdwn", text: `*SPICED*\n${spicedLine}\n\n*BANT*\n${bantLine}` },
          ],
        },
        { type: "section", text: { type: "mrkdwn", text: `> _${scorecard.verdict}_` } },
      ];

      if (scorecard.wins?.length > 0) {
        blocks.push({ type: "divider" });
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*✅ What landed*\n${scorecard.wins.map((w: string) => `• ${w}`).join("\n")}` },
        });
      }
      if (scorecard.fixes?.length > 0) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*🔧 Priority fixes*\n${scorecard.fixes.map((f: string) => `• ${f}`).join("\n")}` },
        });
      }
      if (scorecard.closingTips?.length > 0) {
        blocks.push({ type: "divider" });
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*🎯 Closing tips*\n${scorecard.closingTips.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}` },
        });
      }
      if (scorecard.quoteOfTheCall?.text) {
        blocks.push({ type: "divider" });
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*💬 Quote of the call* (▶ ${scorecard.quoteOfTheCall.timestamp})\n> _"${scorecard.quoteOfTheCall.text}"_`,
          },
        });
      }
      if (url) {
        blocks.push({ type: "divider" });
        blocks.push({
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "📋 View Full Scorecard" }, url, style: "primary" },
          ],
        });
      }

      const result = await slack.chat.postMessage({
        channel: channelId,
        text: `${ragEmoji} New Demo Scored | ${mention} → ${transcript.companyName} — ${scorecard.score}/100`,
        blocks,
        unfurl_links: false,
      });

      if (result.ts) {
        await sql`UPDATE scorecards SET slack_review_ts = ${result.ts} WHERE id = ${scorecardId}`;
      }
      log.push(`  Posted to Slack #demo-reviews`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`  Slack error: ${msg}`);
  }

  log.push(`  Saved ${scorecardId}`);
  return { meetingId, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
}
