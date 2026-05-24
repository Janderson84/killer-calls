#!/usr/bin/env node
require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const apiKey = process.env.FIREFLIES_API_KEY;
const QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      title
      organizer_email
      participants
    }
  }
`;

(async () => {
  // Get a few Pedro calls — one with email, one without
  const calls = await pool.query(
    "SELECT meeting_id, prospect_email, company_name FROM scorecards WHERE rep_name = $1 AND (prospect_email IS NULL OR prospect_email = '') ORDER BY call_date DESC LIMIT 2",
    ["Pedro Cavagnari"]
  );
  const callsWithEmail = await pool.query(
    "SELECT meeting_id, prospect_email, company_name FROM scorecards WHERE rep_name = $1 AND prospect_email IS NOT NULL ORDER BY call_date DESC LIMIT 1",
    ["Pedro Cavagnari"]
  );

  const toCheck = [...calls.rows, ...callsWithEmail.rows];

  for (const row of toCheck) {
    console.log(`--- ${row.company_name} (DB email: ${row.prospect_email || 'null'}) ---`);
    const resp = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: QUERY, variables: { transcriptId: row.meeting_id } }),
    });
    const json = await resp.json();
    if (json.data?.transcript) {
      const t = json.data.transcript;
      console.log("  participants type:", typeof t.participants, "length:", t.participants?.length);
      console.log("  participants:", JSON.stringify(t.participants));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  await pool.end();
})();
