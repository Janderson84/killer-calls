#!/usr/bin/env node
/**
 * Fix missing prospect emails for ALL AEs by re-fetching from Fireflies
 * and properly parsing the comma-concatenated participants array.
 * Then link Pipedrive deals for newly recovered emails.
 */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;
const PIPEDRIVE_API_BASE = "https://api.pipedrive.com/v1";
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;

const AE_EMAILS = new Set([
  "pedro.c@salescloser.ai",
  "edgar.a@salescloser.ai",
  "marc.b@salescloser.ai",
  "alfred.d@salescloser.ai",
  "vanessa.f@salescloser.ai",
  "gleidson.r@salescloser.ai",
  "david.m@salescloser.ai",
  "james.a@salescloser.ai",
  "zachary.o@salescloser.ai",
  "marysol.o@salescloser.ai",
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
      return { dealId: deal.id, title: deal.title, stageName, value: deal.value, status: deal.status };
    }
  }
  return null;
}

async function fixAll() {
  console.log("=== Fix ALL Missing Emails + Pipedrive Backfill ===");

  const result = await pool.query(
    `SELECT id, meeting_id, rep_name, company_name, prospect_email, pipedrive_deal_id 
     FROM scorecards 
     WHERE prospect_email IS NULL OR prospect_email = ''
     ORDER BY rep_name, call_date DESC`
  );

  // Also get calls with prospect_email but no pipedrive_deal_id
  const noDeal = await pool.query(
    `SELECT id, meeting_id, rep_name, company_name, prospect_email, pipedrive_deal_id 
     FROM scorecards 
     WHERE (pipedrive_deal_id IS NULL OR pipedrive_deal_id = '') 
       AND prospect_email IS NOT NULL AND prospect_email != ''
     ORDER BY rep_name, call_date DESC`
  );

  console.log(`${result.rows.length} calls with missing email`);
  console.log(`${noDeal.rows.length} calls with email but no Pipedrive deal`);
  console.log();

  let emailsFixed = 0;
  let emailsStillNull = 0;
  let dealsLinked = 0;
  const repStats = {};

  // Phase 1: Fix missing emails
  for (const row of result.rows) {
    if (!repStats[row.rep_name]) repStats[row.rep_name] = { emailsFixed: 0, dealsLinked: 0 };
    
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
      const participants = json.data?.transcript?.participants;

      if (!participants || participants.length === 0) {
        console.log(`  ❌ ${row.rep_name} → ${row.company_name}: no participants`);
        emailsStillNull++;
        continue;
      }

      const allEmails = participants
        .flatMap((e) => e.split(",").map((s) => s.trim().toLowerCase()))
        .filter((e) => e.includes("@"));

      const prospectEmail = allEmails.find((e) => !AE_EMAILS.has(e)) || null;

      if (!prospectEmail) {
        console.log(`  ❌ ${row.rep_name} → ${row.company_name}: all emails are AEs`);
        emailsStillNull++;
        continue;
      }

      await pool.query(`UPDATE scorecards SET prospect_email = $1 WHERE id = $2`, [prospectEmail, row.id]);
      console.log(`  ✅ ${row.rep_name} → ${row.company_name}: ${prospectEmail}`);
      repStats[row.rep_name].emailsFixed++;
      emailsFixed++;

      // Try Pipedrive link
      const deal = await findDealForProspect(prospectEmail);
      if (deal) {
        await pool.query(
          `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
          [String(deal.dealId), deal.stageName, deal.value, row.id]
        );
        const s = deal.status === "open" ? "🟢" : deal.status === "won" ? "✅" : "🔴";
        console.log(`      → Deal #${deal.dealId} "${deal.title}" | ${deal.stageName} | $${deal.value} | ${s} ${deal.status}`);
        repStats[row.rep_name].dealsLinked++;
        dealsLinked++;
      }

      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      console.error(`  ❌ ${row.rep_name} → ${row.company_name}: ${err.message}`);
      emailsStillNull++;
    }
  }

  // Phase 2: Link Pipedrive deals for calls that have email but no deal
  console.log(``);
  console.log(`--- Phase 2: Link deals for ${noDeal.rows.length} calls with email but no deal ---`);

  for (const row of noDeal.rows) {
    if (!repStats[row.rep_name]) repStats[row.rep_name] = { emailsFixed: 0, dealsLinked: 0 };

    // Extract prospect email (may contain AE email too)
    const parts = (row.prospect_email || "").split(",").map(e => e.trim().toLowerCase());
    const prospectEmail = parts.find(e => !AE_EMAILS.has(e)) || parts[0];

    if (!prospectEmail) continue;

    const deal = await findDealForProspect(prospectEmail);
    if (deal) {
      await pool.query(
        `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
        [String(deal.dealId), deal.stageName, deal.value, row.id]
      );
      const s = deal.status === "open" ? "🟢" : deal.status === "won" ? "✅" : "🔴";
      console.log(`  ✅ ${row.rep_name} → ${row.company_name}: Deal #${deal.dealId} | ${deal.stageName} | $${deal.value} | ${s} ${deal.status}`);
      repStats[row.rep_name].dealsLinked++;
      dealsLinked++;
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(``);
  console.log(`=== SUMMARY ===`);
  console.log(`Emails fixed: ${emailsFixed}, still null: ${emailsStillNull}`);
  console.log(`Pipedrive deals linked: ${dealsLinked}`);
  console.log();
  console.log(`Per AE:`);
  for (const [rep, stats] of Object.entries(repStats).sort()) {
    console.log(`  ${rep}: ${stats.emailsFixed} emails fixed, ${stats.dealsLinked} deals linked`);
  }
  console.log();

  // Final counts
  const final = await pool.query(
    `SELECT rep_name, COUNT(*) as total, COUNT(prospect_email) as has_email, COUNT(pipedrive_deal_id) as has_deal 
     FROM scorecards GROUP BY rep_name ORDER BY total DESC`
  );
  console.log(`Final state:`);
  final.rows.forEach(r => {
    console.log(`  ${r.rep_name}: ${r.has_email}/${r.total} emails, ${r.has_deal}/${r.total} deals`);
  });

  await pool.end();
}

fixAll().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
