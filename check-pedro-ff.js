#!/usr/bin/env node
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Get Pedro's calls with no prospect email
  const result = await pool.query(
    "SELECT meeting_id, company_name, prospect_email, call_date FROM scorecards WHERE rep_name = $1 AND (prospect_email IS NULL OR prospect_email = '') ORDER BY call_date DESC LIMIT 1",
    ["Pedro Cavagnari"]
  );
  
  if (result.rows.length === 0) {
    console.log("No Pedro calls with missing email");
    await pool.end();
    return;
  }
  
  const row = result.rows[0];
  console.log("Checking Fireflies for meeting:", row.meeting_id);
  console.log("Company:", row.company_name);
  console.log("Date:", row.call_date);
  console.log("DB prospect_email:", JSON.stringify(row.prospect_email));
  console.log();
  
  // Fetch the full transcript from Fireflies to check participants
  const apiKey = process.env.FIREFLIES_API_KEY;
  const query = `
    query Transcript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id
        title
        organizer_email
        participants
        speakers {
          id
          name
        }
        sentences {
          speaker_name
          text
        }
      }
    }
  `;
  
  const resp = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables: { transcriptId: row.meeting_id } }),
  });
  
  const json = await resp.json();
  if (json.errors) {
    console.error("Fireflies error:", JSON.stringify(json.errors));
    await pool.end();
    return;
  }
  
  const t = json.data.transcript;
  console.log("=== Fireflies Raw Data ===");
  console.log("Title:", t.title);
  console.log("Organizer:", t.organizer_email);
  console.log("Participants:", JSON.stringify(t.participants));
  console.log("Speakers:");
  (t.speakers || []).forEach(s => {
    console.log("  -", s.name, "|", s.email || "(no email)");
  });
  console.log();
  console.log("First 5 sentences:");
  (t.sentences || []).slice(0, 5).forEach(s => {
    console.log("  [" + s.speaker_name + "]", s.text);
  });
  
  await pool.end();
})();
