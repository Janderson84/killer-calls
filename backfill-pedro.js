#!/usr/bin/env node
/**
 * Backfill Pipedrive deal links for Pedro's scorecards only.
 */
require("dotenv").config();
const { Pool } = require("pg");

const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;
const PIPEDRIVE_API_BASE = "https://api.pipedrive.com/v1";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const AE_EMAILS = new Set([
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
]);

function extractProspectEmail(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map((e) => e.trim().toLowerCase());
  const prospect = parts.find((e) => !AE_EMAILS.has(e));
  return prospect || parts[0] || null;
}

async function pipedriveGet(path) {
  const resp = await fetch(`${PIPEDRIVE_API_BASE}${path}`, {
    headers: { 'X-Api-Token': PIPEDRIVE_API_KEY }
  });
  const data = await resp.json();
  return data;
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

async function backfillPedro() {
  console.log("=== Pedro Pipedrive Backfill ===");

  const result = await pool.query(
    `SELECT id, company_name, prospect_email, pipedrive_deal_id, call_date FROM scorecards WHERE rep_name = $1 ORDER BY call_date DESC`,
    ["Pedro Cavagnari"]
  );

  console.log(`Pedro has ${result.rows.length} scored calls`);

  let linked = 0;
  let noEmail = 0;
  let notFound = 0;
  let alreadyLinked = 0;

  for (const row of result.rows) {
    if (row.pipedrive_deal_id) {
      console.log(`  ⏭️  ${row.company_name}: already linked to deal #${row.pipedrive_deal_id}`);
      alreadyLinked++;
      continue;
    }

    const prospectEmail = extractProspectEmail(row.prospect_email);
    if (!prospectEmail) {
      console.log(`  ❌ ${row.company_name}: no prospect email`);
      noEmail++;
      continue;
    }

    const deal = await findDealForProspect(prospectEmail);
    if (!deal) {
      console.log(`  ❌ ${row.company_name} (${prospectEmail}): no Pipedrive deal`);
      notFound++;
    } else {
      await pool.query(
        `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
        [String(deal.dealId), deal.stageName, deal.value, row.id]
      );
      const s = deal.status === "open" ? "🟢" : deal.status === "won" ? "✅" : "🔴";
      console.log(`  ✅ ${row.company_name} → Deal #${deal.dealId} "${deal.title}" | ${deal.stageName} | $${deal.value} | ${s} ${deal.status}`);
      linked++;
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  console.log();
  console.log(`Results: ${linked} linked, ${alreadyLinked} already linked, ${noEmail} no email, ${notFound} no deal found`);
  console.log(`Total: ${result.rows.length} calls`);

  await pool.end();
}

backfillPedro().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
