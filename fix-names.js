#!/usr/bin/env node
require("dotenv").config();
const { CONFIG } = require("./src/constants");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

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

async function fix() {
  const { rows } = await pool.query("SELECT id, meeting_id, rep_name, company_name FROM scorecards");
  console.log("Checking", rows.length, "records...\n");
  let fixed = 0;

  for (const row of rows) {
    try {
      const resp = await fetch(CONFIG.firefliesEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.FIREFLIES_API_KEY },
        body: JSON.stringify({
          query: `query T($id: String!) { transcript(id: $id) { title organizer_email } }`,
          variables: { id: row.meeting_id },
        }),
      });
      const json = await resp.json();
      const t = json.data && json.data.transcript;
      if (!t) continue;

      const email = (t.organizer_email || "").toLowerCase();
      const knownRep = AE_BY_EMAIL[email];
      if (!knownRep) continue;

      let prospect = "Unknown Company";
      const title = t.title || "";

      // Handle "SalesCloser AI meeting with ..." titles
      const scMatch = title.match(/^SalesCloser AI meeting\s*(?:with\s*)?(.+?)(?:\s*[-–—]\s*.+)?$/i);
      if (scMatch) {
        prospect = scMatch[1].trim();
      } else {
        // Split on " and " to get the two names
        const parts = title.split(/\s+and\s+/i);
        if (parts.length === 2) {
          const a = parts[0].trim();
          const b = parts[1].trim();
          const repFirst = knownRep.split(" ")[0].toLowerCase();
          const aIsRep = a.toLowerCase().includes(repFirst);
          prospect = aIsRep ? b : a;
        } else {
          prospect = title;
        }
      }

      // Also update the reps table name if needed
      if (row.rep_name !== knownRep || row.company_name !== prospect) {
        await pool.query("UPDATE scorecards SET rep_name = $1, company_name = $2 WHERE id = $3", [knownRep, prospect, row.id]);
        console.log(`  ${row.rep_name} => ${knownRep}  |  ${row.company_name} => ${prospect}`);
        fixed++;
      }
    } catch (e) {
      console.error("  ERR", row.meeting_id, e.message);
    }
  }

  console.log("\nFixed", fixed, "of", rows.length, "records");
  await pool.end();
}

fix();
