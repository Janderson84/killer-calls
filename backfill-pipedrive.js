#!/usr/bin/env node
/**
 * Backfill Pipedrive deal links for existing scorecards.
 * Flow: Search Pipedrive persons by prospect email → get their deals → link to scorecard.
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

async function findDealForProspect(email, companyName) {
  // 1. Search for person by email
  const personSearch = await pipedriveGet(
    `/persons/search?term=${encodeURIComponent(email)}&limit=3`
  );

  if (personSearch.success && personSearch.data?.items?.length > 0) {
    const personId = personSearch.data.items[0].item.id;

    // 2. Get deals for that person
    const dealsResp = await pipedriveGet(`/persons/${personId}/deals`);
    if (dealsResp.success && dealsResp.data?.length > 0) {
      // Prefer open deals, then most recently updated
      const deals = dealsResp.data.sort((a, b) => {
        if (a.status === "open" && b.status !== "open") return -1;
        if (a.status !== "open" && b.status === "open") return 1;
        return 0;
      });
      const deal = deals[0];

      // 3. Get stage name
      let stageName = String(deal.stage_id);
      try {
        const stageResp = await pipedriveGet(`/stages/${deal.stage_id}`);
        if (stageResp.success && stageResp.data) {
          stageName = stageResp.data.name;
        }
      } catch (e) {}

      return {
        dealId: deal.id,
        title: deal.title,
        stageId: deal.stage_id,
        stageName,
        value: deal.value,
        status: deal.status,
        currency: deal.currency,
      };
    }
  }

  // Fallback: search deals directly by company name
  const dealSearch = await pipedriveGet(
    `/deals/search?term=${encodeURIComponent(companyName)}&limit=3`
  );
  if (dealSearch.success && dealSearch.data?.items?.length > 0) {
    const dealItem = dealSearch.data.items[0].item;
    let stageName = "unknown";
    try {
      const dealDetail = await pipedriveGet(`/deals/${dealItem.id}`);
      if (dealDetail.success && dealDetail.data) {
        const stageResp = await pipedriveGet(`/stages/${dealDetail.data.stage_id}`);
        if (stageResp.success && stageResp.data) stageName = stageResp.data.name;
        return {
          dealId: dealItem.id,
          title: dealDetail.data.title,
          stageId: dealDetail.data.stage_id,
          stageName,
          value: dealDetail.data.value,
          status: dealDetail.data.status,
          currency: dealDetail.data.currency,
        };
      }
    } catch (e) {}
  }

  return null;
}

async function backfill() {
  console.log("=== Pipedrive Deal Backfill ===");

  if (!PIPEDRIVE_API_KEY) {
    console.error("PIPEDRIVE_API_KEY not set. Exiting.");
    process.exit(1);
  }

  // Get the most recent scorecard per active AE
  const result = await pool.query(`
    SELECT DISTINCT ON (rep_name) id, rep_name, company_name, prospect_email, call_date
    FROM scorecards
    WHERE rep_name NOT IN ('Zachary Obando', 'Marysol Ortega')
    ORDER BY rep_name, call_date DESC
  `);

  console.log(`Found ${result.rows.length} AEs. Running Pipedrive lookups...`);
  console.log();

  let linked = 0;
  let notFound = 0;

  for (const row of result.rows) {
    const prospectEmail = extractProspectEmail(row.prospect_email);
    if (!prospectEmail) {
      console.log(`❌ ${row.rep_name} → ${row.company_name}: No prospect email`);
      notFound++;
      continue;
    }

    console.log(`🔎 ${row.rep_name} → ${row.company_name} (${prospectEmail})`);

    const deal = await findDealForProspect(prospectEmail, row.company_name);
    if (!deal) {
      console.log(`  ❌ No Pipedrive deal found`);
      notFound++;
    } else {
      await pool.query(
        `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
        [String(deal.dealId), deal.stageName, deal.value, row.id]
      );
      const statusIcon = deal.status === "open" ? "🟢" : deal.status === "won" ? "✅" : "🔴";
      console.log(
        `  ✅ Deal #${deal.dealId}: "${deal.title}" | ${deal.stageName} | $${deal.value} ${deal.currency || "USD"} | ${statusIcon} ${deal.status}`
      );
      linked++;
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  console.log();
  console.log(`Results: ${linked} linked, ${notFound} not found out of ${result.rows.length}`);

  await pool.end();
}

backfill().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
