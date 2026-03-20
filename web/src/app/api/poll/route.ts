import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import Anthropic from "@anthropic-ai/sdk";
import {
  SCORING_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
} from "@/lib/scoring-prompts";
import {
  postDemoReview,
  postKillerCall,
  type TeamConfig,
} from "@/lib/slack-formatter";
import { extractPlaybookExamples } from "@/lib/playbook";

// ─── Config ─────────────────────────────────────────────────────
// AE list is now loaded from the ae_roster setting in the DB.
// No more hardcoded email lists.

const FIREFLIES_ENDPOINT = "https://api.fireflies.ai/graphql";
const MIN_DURATION_MINUTES = 20;

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s+call|second\s+call|check[\s-]?in/i;

interface RosterEntry {
  name: string;
  email: string;
  slackId: string;
  active?: boolean;
}

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
    // 0. Load active AEs from all team rosters
    const rosterRows = await sql`SELECT team_id, value FROM settings WHERE key = 'ae_roster'`;
    const activeAeEmails: string[] = [];
    const aeByEmail: Record<string, string> = {};
    const aeTeamMap: Record<string, string> = {};
    for (const row of rosterRows) {
      const roster = (typeof row.value === "string" ? JSON.parse(row.value as string) : row.value) as RosterEntry[];
      if (!Array.isArray(roster)) continue;
      for (const ae of roster) {
        if (ae.active === false) {
          log.push(`  Skipping inactive AE: ${ae.name}`);
          continue;
        }
        if (ae.email) {
          const email = ae.email.toLowerCase();
          activeAeEmails.push(email);
          aeByEmail[email] = ae.name;
          aeTeamMap[email] = row.team_id as string;
        }
      }
    }
    const aeEmailSet = new Set(activeAeEmails);
    log.push(`  ${activeAeEmails.length} active AEs across ${rosterRows.length} team(s)`);

    // 1. Get already-scored + skipped meeting IDs
    const scoredRows = await sql`SELECT meeting_id FROM scorecards`;
    const skippedRows = await sql`SELECT meeting_id FROM skipped_meetings`;
    const processed = new Set([
      ...scoredRows.map((r) => r.meeting_id),
      ...skippedRows.map((r) => r.meeting_id),
    ]);
    log.push(`  ${scoredRows.length} scored, ${skippedRows.length} skipped`);

    // 2. Fetch recent transcripts for each active AE
    const newMeetings: { id: string; title: string; email: string }[] = [];
    for (const email of activeAeEmails) {
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
    const MAX_SCORED_PER_RUN = 9;
    const results: { meetingId: string; score?: number; rag?: string; rep?: string; skipped?: boolean }[] = [];
    let scoredCount = 0;

    for (const meeting of newMeetings) {
      if (scoredCount >= MAX_SCORED_PER_RUN) break;
      try {
        const result = await processOne(meeting.id, meeting.email, sql, log, aeByEmail, aeEmailSet, aeTeamMap);
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
async function fetchRecentByOrganizer(email: string, apiKey?: string) {
  const key = apiKey || process.env.FIREFLIES_API_KEY;
  const resp = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
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
async function fetchTranscript(meetingId: string, aeByEmail: Record<string, string>, aeEmailSet: Set<string>, apiKey?: string) {
  const key = apiKey || process.env.FIREFLIES_API_KEY;
  const resp = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
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
  const knownRep = aeByEmail[organizerEmail];
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
    .find((e: string) => e.includes("@") && !aeEmailSet.has(e)) || null;

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

  // Ensure close object always exists — model sometimes omits it.
  // Claude returns close data under "pushToClose" (not "closeExecution").
  if (!scorecard.close || scorecard.close.style === "none") {
    const closePhase = scorecard.phases?.closing?.criteria?.closeExecution
      || scorecard.phases?.closing?.criteria?.pushToClose;
    if (closePhase && closePhase.score > 0) {
      const score = closePhase.score;
      const maxPts = closePhase.maxPoints || 10;
      const ratio = score / maxPts;
      const feedback = closePhase.feedback || "";
      const timestamps = closePhase.timestamps || [];

      // Detect close style from feedback text
      const fbLower = feedback.toLowerCase();
      let style = "consultative";
      let styleName = "Consultative Close";
      if (/assumptive|assumed|let.?s get started|here.?s how we start/i.test(fbLower)) {
        style = "assumptive"; styleName = "Assumptive Close";
      } else if (/urgency|deadline|critical event|time.?bound|end of (quarter|month|week)/i.test(fbLower)) {
        style = "urgency"; styleName = "Urgency Close";
      }

      const setupStatus = ratio >= 0.7 ? "strong" : ratio >= 0.4 ? "partial" : "missing";
      const askStatus = ratio >= 0.7 ? "strong" : ratio >= 0.2 ? "partial" : "missing";
      scorecard.close = {
        style,
        styleName,
        setup: { score: Math.round(ratio * 4), status: setupStatus, label: style === "assumptive" ? "Read Buying Signals" : style === "urgency" ? "Tie to Critical Event" : "Summarize Value", feedback, timestamps },
        bridge: { score: Math.round(ratio * 3), status: setupStatus, label: style === "assumptive" ? "Smooth Transition" : style === "urgency" ? "Build the Timeline" : "Surface Blockers", feedback: "", timestamps: [] },
        ask: { score: Math.round(ratio * 3), status: askStatus, label: style === "assumptive" ? "Lock Specific Action" : style === "urgency" ? "Propose the Plan" : "Ask for Commitment", feedback: "", timestamps: [] },
      };
    } else if (!scorecard.close) {
      scorecard.close = {
        style: "none",
        styleName: "No Close Detected",
        setup: { score: 0, status: "missing", label: "No setup detected", feedback: "No close execution was detected in this call.", timestamps: [] },
        bridge: { score: 0, status: "missing", label: "No bridge detected", feedback: "No close execution was detected in this call.", timestamps: [] },
        ask: { score: 0, status: "missing", label: "No ask detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      };
    }
  }
  return scorecard;
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
  organizerEmail: string,
  sql: any,
  log: string[],
  aeByEmail: Record<string, string>,
  aeEmailSet: Set<string>,
  aeTeamMap: Record<string, string>,
) {
  // Claim this meeting so no other pipeline processes it concurrently
  const claim = await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${meetingId}, ${"processing"}) ON CONFLICT DO NOTHING RETURNING meeting_id`;
  if (claim.length === 0) {
    log.push(`  meetingId=${meetingId} already claimed — skipping`);
    return { meetingId, skipped: true };
  }

  log.push(`  Fetching transcript ${meetingId}...`);
  const transcript = await fetchTranscript(meetingId, aeByEmail, aeEmailSet);
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

  // Check excluded patterns from all teams
  const excludedRows = await sql`SELECT value FROM settings WHERE key = 'excluded_patterns'`;
  for (const row of excludedRows) {
    const patterns = (Array.isArray(row.value) ? row.value : []) as string[];
    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern, "i").test(transcript.title || "")) {
          log.push(`  Skipped — title matches excluded pattern "${pattern}"`);
          await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${meetingId}, ${"excluded pattern"}) ON CONFLICT DO NOTHING`;
          return { meetingId, skipped: true };
        }
      } catch { /* invalid regex, skip */ }
    }
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
    ? buildFollowupScoringPrompt(transcript.transcriptText, transcript.repName, transcript.companyName, transcript.durationMinutes, priorCallContext)
    : buildScoringPrompt(transcript.transcriptText, transcript.repName, transcript.companyName, transcript.durationMinutes);
  const systemPrompt = isFollowup ? FOLLOWUP_SYSTEM_PROMPT : SCORING_SYSTEM_PROMPT;
  const scorecard = await scoreCall(prompt, systemPrompt);
  log.push(`  Score: ${scorecard.score}/100 (${scorecard.rag})`);

  // Resolve team from the organizer email → team mapping built from rosters
  let teamId: string | null = aeTeamMap[organizerEmail.toLowerCase()] || null;
  if (!teamId) {
    // Fallback: use the first team if no match
    const fallback = await sql`SELECT id FROM teams LIMIT 1`;
    teamId = fallback.length > 0 ? (fallback[0].id as string) : null;
  }
  if (!teamId) {
    log.push(`  No team found — skipping`);
    return { meetingId, skipped: true };
  }

  // Save to DB
  const repRows = await sql`SELECT id FROM reps WHERE name = ${transcript.repName} AND team_id = ${teamId} LIMIT 1`;
  let repId: string;
  if (repRows.length > 0) {
    repId = repRows[0].id;
  } else {
    const newRep = await sql`INSERT INTO reps (name, team_id) VALUES (${transcript.repName}, ${teamId}) RETURNING id`;
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
      scorecard_json, team_id
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
      ${JSON.stringify(scorecard)}, ${teamId}
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      score = EXCLUDED.score, rag = EXCLUDED.rag, verdict = EXCLUDED.verdict,
      scorecard_json = EXCLUDED.scorecard_json,
      bant_b = EXCLUDED.bant_b, bant_a = EXCLUDED.bant_a,
      bant_n = EXCLUDED.bant_n, bant_t = EXCLUDED.bant_t,
      close_style = EXCLUDED.close_style, close_setup = EXCLUDED.close_setup,
      close_bridge = EXCLUDED.close_bridge, close_ask = EXCLUDED.close_ask,
      call_type = EXCLUDED.call_type, prospect_email = EXCLUDED.prospect_email,
      team_id = EXCLUDED.team_id
    RETURNING id`;

  const scorecardId = inserted[0].id;

  // Release the processing claim now that the scorecard is saved
  await sql`DELETE FROM skipped_meetings WHERE meeting_id = ${meetingId}`;

  // Extract playbook examples from this scorecard
  try {
    await extractPlaybookExamples(sql, scorecard, {
      repName: transcript.repName,
      companyName: transcript.companyName,
      date: transcript.date,
      callType,
    }, scorecardId, teamId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`  Playbook extraction error: ${msg}`);
  }

  // Load team settings for Slack config
  const teamSettingsRows = await sql`SELECT key, value FROM settings WHERE team_id = ${teamId}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamSettings: Record<string, any> = {};
  for (const row of teamSettingsRows) {
    teamSettings[row.key as string] = row.value;
  }
  const teamRoster = (teamSettings.ae_roster || []) as { name: string; email: string; slackId: string }[];

  // Post to Slack via shared formatter
  const slackToken = (teamSettings.slack_bot_token as string) || process.env.SLACK_BOT_TOKEN;
  const reviewChannelId = (teamSettings.slack_channel_reviews as string) || process.env.SLACK_CHANNEL_REVIEWS;
  const killerChannelId = (teamSettings.slack_channel_killer as string) || process.env.SLACK_CHANNEL_KILLER;
  const killerThreshold = teamSettings.killer_threshold ? Number(teamSettings.killer_threshold) : 80;
  const appUrl = (teamSettings.app_url as string) || process.env.APP_URL;

  const slackMeta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    durationMinutes: transcript.durationMinutes,
    date: transcript.date,
    callType,
  };
  const slackTeamConfig: TeamConfig = {
    channelId: reviewChannelId,
    killerChannelId,
    appUrl,
    roster: teamRoster,
    slackBotToken: slackToken,
    killerThreshold,
  };

  try {
    // Post #demo-reviews message + coaching thread
    const { reviewTs } = await postDemoReview(scorecard, slackMeta, scorecardId, slackTeamConfig);
    if (reviewTs) {
      await sql`UPDATE scorecards SET slack_review_ts = ${reviewTs} WHERE id = ${scorecardId}`;
      log.push(`  Posted to Slack #demo-reviews`);
    }

    // Post to #killer-calls if score meets threshold
    const { killerTs } = await postKillerCall(scorecard, slackMeta, scorecardId, slackTeamConfig);
    if (killerTs) {
      await sql`UPDATE scorecards SET slack_killer_ts = ${killerTs} WHERE id = ${scorecardId}`;
      log.push(`  Posted to Slack #killer-calls`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`  Slack error: ${msg}`);
  }

  log.push(`  Saved ${scorecardId}`);
  return { meetingId, score: scorecard.score, rag: scorecard.rag, rep: transcript.repName };
}
