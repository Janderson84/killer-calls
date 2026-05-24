#!/usr/bin/env node
/**
 * Fix Pedro's missing prospect emails by re-fetching from Fireflies
 * and properly parsing the participants array.
 * Then re-run Pipedrive backfill for those calls.
 */
require("dotenv").config();
const { Pool } = require("pg");

const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;
const PIPEDRIVE_API_BASE = "https://api.pipedrive.com/v1";
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const AE_EMAILS = new Set([
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
  "james.a@salescloser.ai", // James sometimes joins calls
]);

const FF_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id
      participants
    }
  }
`;

async function pipedriveGet(path) {
  const sep = path.includes("?") ? "&" : "?";
  const resp = await fetch(`${PIPEDRIVE_API_BASE}${path}${sep}api_token=${PIPEDRIVE_API_KEY}`);
  return resp.json();
}

async function findDealForProspect(email) {
  const personSearch = await pipedriveGet(
    `/persons/search?term=${encodeURIComponent(email)}&limit=3`
  );
  if (personSearch.success && personSearch.data?.items?.length > 0) {
    const personId = personSearch.data.items[0].item.id;
    const dealsResp = await pipedriveGet(`/persons/${personId}/deals`);
    if (dealsResp.success && dealsResp.data?.length > 0) {
      const deals = dealsResp.data.sort((a, b) => {
        if (a.status === "open" && b.status !== "open") return -1;
        if (a.status !== "open" && b.status === "open") return 1;
        return 0;
      });
      const deal = deals[0];
      let stageName = String(deal.stage_id);
      try {
        const stageResp = await pipedriveGet(`/stages/${deal.stage_id}`);
        if (stageResp.success && stageResp.data) stageName = stageResp.data.name;
      } catch (e) {}
      return { dealId: deal.id, title: deal.title, stageName, value: deal.value, status: deal.status, currency: deal.currency };
    }
  }
  return null;
}

async function fixPedro() {
  console.log("=== Fix Pedro Missing Emails + Pipedrive Backfill ===");

  // Get Pedro's calls with no prospect email
  const result = await pool.query(
    `SELECT id, meeting_id, company_name, prospect_email, pipedrive_deal_id FROM scorecards 
     WHERE rep_name = $1 AND (prospect_email IS NULL OR prospect_email = '')
     ORDER BY call_date DESC`,
    ["Pedro Cavagnari"]
  );

  console.log(`Found ${result.rows.length} calls with missing email`);

  let fixed = 0;
  let stillNull = 0;
  let pipedriveLinked = 0;

  for (const row of result.rows) {
    // Fetch from Fireflies
    let participants = null;
    try {
      const resp = await fetch("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIREFLIES_API_KEY}`,
        },
        body: JSON.stringify({ query: FF_QUERY, variables: { transcriptId: row.meeting_id } }),
      });
      const json = await resp.json();
      if (json.data?.transcript) {
        participants = json.data.transcript.participants;
      }
    } catch (err) {
      console.error(`  ❌ ${row.company_name}: Fireflies fetch error: ${err.message}`);
      stillNull++;
      continue;
    }

    if (!participants || participants.length === 0) {
      console.log(`  ❌ ${row.company_name}: no participants in Fireflies`);
      stillNull++;
      continue;
    }

    // Properly parse: split each element by comma, flatten, filter
    const allEmails = participants
      .flatMap((e) => e.split(",").map((s) => s.trim().toLowerCase()))
      .filter((e) => e.includes("@"));

    const prospectEmail = allEmails.find((e) => !AE_EMAILS.has(e)) || null;

    if (!prospectEmail) {
      console.log(`  ❌ ${row.company_name}: all emails are AEs (${allEmails.join(", ")})`);
      stillNull++;
      continue;
    }

    // Update DB with the extracted email
    await pool.query(
      `UPDATE scorecards SET prospect_email = $1 WHERE id = $2`,
      [prospectEmail, row.id]
    );
    console.log(`  ✅ ${row.company_name}: extracted email ${prospectEmail}`);
    fixed++;

    // Now try Pipedrive link
    if (!row.pipedrive_deal_id) {
      const deal = await findDealForProspect(prospectEmail);
      if (deal) {
        await pool.query(
          `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
          [String(deal.dealId), deal.stageName, deal.value, row.id]
        );
        const s = deal.status === "open" ? "🟢" : deal.status === "won" ? "✅" : "🔴";
        console.log(`      → Deal #${deal.dealId} "${deal.title}" | ${deal.stageName} | $${deal.value} | ${s} ${deal.status}`);
        pipedriveLinked++;
      } else {
        console.log(`      → No Pipedrive deal found`);
      }
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  console.log();
  console.log(`Email fix: ${fixed} fixed, ${stillNull} still null out of ${result.rows.length}`);
  console.log(`Pipedrive: ${pipedriveLinked} newly linked`);
  console.log();

  // Summary of all Pedro calls now
  const summary = await pool.query(
    `SELECT COUNT(*) as total, COUNT(prospect_email) as has_email, COUNT(pipedrive_deal_id) as has_deal FROM scorecards WHERE rep_name = $1`,
    ["Pedro Cavagnari"]
  );
  const s = summary.rows[0];
  console.log(`Pedro final state: ${s.total} calls, ${s.has_email} with email, ${s.has_deal} with Pipedrive deal`);

  await pool.end();
}

fixPedro().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
