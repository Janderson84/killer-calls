const { CONFIG } = require("./constants");

// ─── Fireflies GraphQL Client ────────────────────────────────────
// Fetches a full transcript by meetingId.
// Returns a normalized object the scoring engine can consume.

const TRANSCRIPT_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      date
      duration
      speakers {
        id
        name
      }
      sentences {
        index
        text
        raw_text
        start_time
        end_time
        speaker_id
        speaker_name
      }
      organizer_email
      participants
    }
  }
`;

async function fetchTranscript(meetingId) {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) throw new Error("FIREFLIES_API_KEY is not set");

  const response = await fetch(CONFIG.firefliesEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query: TRANSCRIPT_QUERY,
      variables: { transcriptId: meetingId }
    })
  });

  if (!response.ok) {
    throw new Error(`Fireflies API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`Fireflies GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const t = json.data.transcript;
  if (!t) {
    throw new Error(`No transcript found for meetingId: ${meetingId}`);
  }

  // Build a readable transcript string from sentences
  const transcriptText = buildTranscriptText(t.sentences);

  // Try to extract rep name and company from title or participants
  const { repName, companyName } = extractCallMeta(t);

  return {
    meetingId: t.id,
    title: t.title,
    date: t.date ? new Date(t.date).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric"
    }) : "Unknown date",
    durationMinutes: t.duration ? Math.round(t.duration) : null,
    repName,
    companyName,
    transcriptText,
    sentences: t.sentences,
    participants: t.participants || [],
    speakerCount: t.speakers ? t.speakers.length : 0
  };
}

// Convert sentences into a readable transcript with timestamps
function buildTranscriptText(sentences) {
  if (!sentences || sentences.length === 0) return "";

  return sentences.map((s) => {
    const mins = Math.floor((s.start_time || 0) / 60);
    const secs = Math.floor((s.start_time || 0) % 60);
    const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    const speaker = s.speaker_name || "Unknown";
    const text = s.text || s.raw_text || "";
    return `[${ts}] ${speaker}: ${text}`;
  }).join("\n");
}

// ─── AE lookup by organizer email ─────────────────────────────────
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

function extractCallMeta(transcript) {
  const title = transcript.title || "";
  const organizerEmail = (transcript.organizer_email || "").toLowerCase();
  let repName = "Unknown Rep";
  let companyName = "Unknown Company";

  // 1. Use organizer email to identify the AE (rep)
  const knownRep = AE_BY_EMAIL[organizerEmail];

  if (knownRep) {
    repName = knownRep;

    // Extract prospect name by removing the AE name from the title
    // Titles are like "Prospect Name and AE Name" or "AE Name and Prospect Name"
    // Also handle "SalesCloser AI meeting with ..." titles
    const salesCloserMatch = title.match(/^SalesCloser AI meeting\s*(?:with\s*)?(.+?)(?:\s*[-–—]\s*.+)?$/i);
    if (salesCloserMatch) {
      companyName = salesCloserMatch[1].trim();
    } else {
      // Split on " and " to separate the two names
      const parts = title.split(/\s+and\s+/i);
      if (parts.length === 2) {
        const a = parts[0].trim();
        const b = parts[1].trim();
        // Whichever part is NOT the rep is the prospect
        const aIsRep = a.toLowerCase().includes(knownRep.split(" ")[0].toLowerCase());
        companyName = aIsRep ? b : a;
      } else {
        // Try other separators
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
  } else {
    // Fallback for non-AE organizers
    const arrowMatch = title.match(/^(.+?)\s*(?:<>|→|->|with)\s*(.+)$/i);
    if (arrowMatch) {
      repName = arrowMatch[1].trim();
      companyName = arrowMatch[2].trim();
    } else {
      const parts = title.split(/\s+and\s+/i);
      if (parts.length === 2) {
        repName = parts[0].trim();
        companyName = parts[1].trim();
      } else {
        if (transcript.sentences && transcript.sentences.length > 0) {
          repName = transcript.sentences[0].speaker_name || repName;
        }
        companyName = title || companyName;
      }
    }
  }

  return { repName, companyName };
}

module.exports = { fetchTranscript };
