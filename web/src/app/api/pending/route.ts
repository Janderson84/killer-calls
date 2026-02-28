import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ─── Config ─────────────────────────────────────────────────────
const AE_EMAILS = [
  "pedro.c@salescloser.ai", "edgar.a@salescloser.ai", "marc.b@salescloser.ai",
  "zachary.o@salescloser.ai", "alfred.d@salescloser.ai", "vanessa.f@salescloser.ai",
  "marysol.o@salescloser.ai", "gleidson.r@salescloser.ai", "david.m@salescloser.ai",
];

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

export const maxDuration = 60;

// Returns the next unscored call's transcript, or { status: "empty" }
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Get processed IDs
    const scoredRows = await sql`SELECT meeting_id FROM scorecards`;
    const skippedRows = await sql`SELECT meeting_id FROM skipped_meetings`;
    const processed = new Set([
      ...scoredRows.map((r) => r.meeting_id),
      ...skippedRows.map((r) => r.meeting_id),
    ]);

    // Find new meetings
    for (const email of AE_EMAILS) {
      let transcripts;
      try {
        transcripts = await fetchRecentByOrganizer(email);
      } catch {
        continue;
      }

      for (const t of transcripts) {
        if (processed.has(t.id)) continue;

        // Fetch full transcript
        let full;
        try {
          full = await fetchTranscript(t.id);
        } catch {
          continue;
        }

        // Skip short/no-show
        if (full.durationMinutes && full.durationMinutes < MIN_DURATION_MINUTES) {
          await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${t.id}, ${"too short"}) ON CONFLICT DO NOTHING`;
          continue;
        }
        if (full.speakerCount < 2) {
          await sql`INSERT INTO skipped_meetings (meeting_id, reason) VALUES (${t.id}, ${"no-show"}) ON CONFLICT DO NOTHING`;
          continue;
        }

        // Return this call for scoring
        return NextResponse.json({
          status: "pending",
          meetingId: full.meetingId,
          title: full.title,
          repName: full.repName,
          companyName: full.companyName,
          date: full.date,
          durationMinutes: full.durationMinutes,
          transcriptText: full.transcriptText,
        });
      }
    }

    return NextResponse.json({ status: "empty", message: "No new calls to score" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}

async function fetchRecentByOrganizer(email: string) {
  const resp = await fetch(FIREFLIES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIREFLIES_API_KEY}`,
    },
    body: JSON.stringify({
      query: `query RecentTranscripts($organizerEmail: String) {
        transcripts(organizer_email: $organizerEmail, limit: 10) { id title date organizer_email }
      }`,
      variables: { organizerEmail: email },
    }),
  });
  if (!resp.ok) throw new Error(`Fireflies API ${resp.status}`);
  const json = await resp.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.transcripts || [];
}

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
        companyName = title;
      }
    }
  }

  return {
    meetingId: t.id, title: t.title,
    date: t.date ? new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown date",
    durationMinutes: t.duration ? Math.round(t.duration) : null,
    repName, companyName, transcriptText,
    speakerCount: t.speakers ? t.speakers.length : 0,
  };
}
