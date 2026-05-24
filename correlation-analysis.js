#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Map text statuses to numeric for analysis
const STATUS_MAP = { 'strong': 3, 'partial': 2, 'weak': 1, 'missing': 0, 'none': 0 };

function statusToNum(val) {
  if (val == null) return null;
  const lower = String(val).toLowerCase().trim();
  return STATUS_MAP[lower] ?? null;
}

async function run() {
  try {
    // 1. Count with pipedrive vs without
    const counts = await pool.query("SELECT COUNT(*) as total, COUNT(pipedrive_deal_id) as with_deal FROM scorecards");
    console.log(`Total scorecards: ${counts.rows[0].total}, with Pipedrive link: ${counts.rows[0].with_deal}`);

    // 2. Pull all scorecards with pipedrive data for analysis
    const data = await pool.query(`
      SELECT rep_name, company_name, score, rag, pipedrive_deal_id, pipedrive_deal_stage, pipedrive_deal_value,
        score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        bant_b, bant_a, bant_n, bant_t,
        close_style, close_setup, close_bridge, close_ask,
        call_date, call_type
      FROM scorecards
      WHERE pipedrive_deal_id IS NOT NULL
      ORDER BY score DESC
    `);

    const rows = data.rows;
    console.log(`Analyzing ${rows.length} scorecards with Pipedrive links`);

    // 3. Categorize deal stages into buckets
    const STALLED_STAGES = ['Demo Held', 'Nurture / Long Term Follow Up', 'Nurture / Long Term Followup', 'Unqualified', 'Long Term (email drip)', 'Email Drip', 'Demo Scheduled', 'Contact Made', 'Positive Contact Made', 'Meeting Booked'];
    const OBJECTION_STAGES = ['Obejction / Working It', 'Objection / Working it', 'Closing Call Sheduled', 'Closing Call Scheduled'];
    const CLOSED_STAGES = ['Closed', 'Closed $$$', 'Closed/$$ 100%', 'Closed/Paid', 'Waiting for Payment', 'Closing Call Held / Decision Pending'];

    function categorize(stage) {
      if (!stage) return 'unknown';
      const s = stage.trim();
      if (CLOSED_STAGES.some(c => s.toLowerCase() === c.toLowerCase())) return 'closed';
      if (OBJECTION_STAGES.some(c => s.toLowerCase() === c.toLowerCase())) return 'objection';
      if (STALLED_STAGES.some(c => s.toLowerCase() === c.toLowerCase())) return 'stalled';
      return 'other';
    }

    const buckets = { stalled: [], objection: [], closed: [], other: [] };
    rows.forEach(r => {
      const cat = categorize(r.pipedrive_deal_stage);
      r.dealBucket = cat;
      buckets[cat].push(r);
    });

    console.log(`Buckets: stalled=${buckets.stalled.length}, objection=${buckets.objection.length}, closed=${buckets.closed.length}, other=${buckets.other.length}`);

    // 4. Compute avg scores per bucket
    function avg(arr, key) {
      const vals = arr.map(r => r[key]).filter(v => v != null).map(v => typeof v === 'number' ? v : statusToNum(v)).filter(v => v != null);
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 'N/A';
    }

    function stats(bucket, label) {
      const n = bucket.length;
      if (n === 0) return;
      console.log(``);
      console.log(`=== ${label} (n=${n}) ===`);
      console.log(`  Overall Score:     ${avg(bucket, 'score')}`);
      console.log(`  Discovery:        ${avg(bucket, 'score_discovery')}`);
      console.log(`  Presentation:      ${avg(bucket, 'score_presentation')}`);
      console.log(`  Pricing:           ${avg(bucket, 'score_pricing')}`);
      console.log(`  Closing:           ${avg(bucket, 'score_closing')}`);
      console.log(`  SPICED-S (Situation): ${avg(bucket, 'spiced_s')}`);
      console.log(`  SPICED-P (Pain):     ${avg(bucket, 'spiced_p')}`);
      console.log(`  SPICED-I (Impact):   ${avg(bucket, 'spiced_i')}`);
      console.log(`  SPICED-C (Critical): ${avg(bucket, 'spiced_c')}`);
      console.log(`  SPICED-E (Decision): ${avg(bucket, 'spiced_e')}`);
    }

    stats(buckets.stalled, 'STALLED (Demo Held / Nurture / Unqualified)');
    stats(buckets.objection, 'OBJECTION (Working It / Closing Scheduled)');
    stats(buckets.closed, 'CLOSED (Won / Payment / Decision Pending)');
    stats(buckets.other, 'OTHER');

    // 5. "Progressed" = objection + closed, "Stalled" = stalled
    const progressed = [...buckets.objection, ...buckets.closed];
    console.log(``);
    console.log(`=== PROGRESSED (objection+closed, n=${progressed.length}) vs STALLED (n=${buckets.stalled.length}) ===`);
    console.log(`  Progressed Score:    ${avg(progressed, 'score')}  |  Stalled Score:    ${avg(buckets.stalled, 'score')}`);
    console.log(`  Progressed Discovery:${avg(progressed, 'score_discovery')}  |  Stalled Discovery:${avg(buckets.stalled, 'score_discovery')}`);
    console.log(`  Progressed Pain:     ${avg(progressed, 'spiced_p')}  |  Stalled Pain:     ${avg(buckets.stalled, 'spiced_p')}`);
    console.log(`  Progressed Impact:   ${avg(progressed, 'spiced_i')}  |  Stalled Impact:   ${avg(buckets.stalled, 'spiced_i')}`);
    console.log(`  Progressed Critical: ${avg(progressed, 'spiced_c')}  |  Stalled Critical: ${avg(buckets.stalled, 'spiced_c')}`);
    console.log(`  Progressed Decision: ${avg(progressed, 'spiced_e')}  |  Stalled Decision: ${avg(buckets.stalled, 'spiced_e')}`);
    console.log(`  Progressed Closing: ${avg(progressed, 'score_closing')}  |  Stalled Closing: ${avg(buckets.stalled, 'score_closing')}`);

    // 6. Per-rep breakdown with deal progression
    const reps = {};
    rows.forEach(r => {
      if (!reps[r.rep_name]) reps[r.rep_name] = { progressed: [], stalled: [], all: [] };
      reps[r.rep_name].all.push(r);
      if (r.dealBucket === 'stalled') reps[r.rep_name].stalled.push(r);
      else reps[r.rep_name].progressed.push(r);
    });

    console.log(``);
    console.log(`=== PER-REP PROGRESSION RATES ===`);
    Object.entries(reps).sort((a, b) => b[1].all.length - a[1].all.length).forEach(([name, d]) => {
      const total = d.all.length;
      const pctProg = total ? ((d.progressed.length / total) * 100).toFixed(0) : 0;
      console.log(`  ${name}: ${total} scored calls, ${d.progressed.length} progressed (${pctProg}%), ${d.stalled.length} stalled | Avg Score: ${avg(d.all, 'score')} | Avg Pain: ${avg(d.all, 'spiced_p')} | Avg Impact: ${avg(d.all, 'spiced_i')}`);
    });

    // 7. Close style effectiveness
    const closeStyles = {};
    rows.forEach(r => {
      const style = r.close_style || 'none';
      if (!closeStyles[style]) closeStyles[style] = { progressed: 0, stalled: 0 };
      if (r.dealBucket === 'stalled') closeStyles[style].stalled++;
      else closeStyles[style].progressed++;
    });
    console.log(``);
    console.log(`=== CLOSE STYLE vs DEAL PROGRESSION ===`);
    Object.entries(closeStyles).sort((a, b) => (b[1].progressed + b[1].stalled) - (a[1].progressed + a[1].stalled)).forEach(([style, d]) => {
      const total = d.progressed + d.stalled;
      console.log(`  ${style}: ${d.progressed}/${total} progressed (${((d.progressed / total) * 100).toFixed(0)}%)`);
    });

    // 8. Deal value vs score
    const withValue = rows.filter(r => r.pipedrive_deal_value && parseFloat(r.pipedrive_deal_value) > 0);
    if (withValue.length > 0) {
      const highValue = withValue.filter(r => parseFloat(r.pipedrive_deal_value) >= 500);
      const lowValue = withValue.filter(r => parseFloat(r.pipedrive_deal_value) < 500);
      console.log(``);
      console.log(`=== DEAL VALUE vs SCORE (n=${withValue.length} deals with value) ===`);
      if (highValue.length) console.log(`  High-value (>$500/mo, n=${highValue.length}): Avg Score ${avg(highValue, 'score')}, Avg Pain ${avg(highValue, 'spiced_p')}, Avg Impact ${avg(highValue, 'spiced_i')}`);
      if (lowValue.length) console.log(`  Low-value (<$500/mo, n=${lowValue.length}): Avg Score ${avg(lowValue, 'score')}, Avg Pain ${avg(lowValue, 'spiced_p')}, Avg Impact ${avg(lowValue, 'spiced_i')}`);
    }

  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

run();
