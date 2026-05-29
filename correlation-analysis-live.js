#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY;
const STATUS_MAP = { 'strong': 3, 'partial': 2, 'weak': 1, 'missing': 0, 'none': 0 };

function statusToNum(val) {
  if (val == null) return null;
  return STATUS_MAP[String(val).toLowerCase().trim()] ?? null;
}

function avg(arr, key) {
  const vals = arr.map(r => r[key]).filter(v => v != null).map(v => typeof v === 'number' ? v : statusToNum(v)).filter(v => v != null);
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function fmt(v) { return v != null ? v.toFixed(2) : 'N/A'; }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDeal(dealId) {
  try {
    const resp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}`, {
      headers: { "X-Api-Token": PIPEDRIVE_KEY }
    });
    const json = await resp.json();
    if (json.success && json.data) {
      return {
        id: json.data.id,
        status: json.data.status,
        stage_id: json.data.stage_id,
        value: json.data.value,
        pipeline_id: json.data.pipeline_id,
        title: json.data.title
      };
    }
  } catch (e) {}
  return null;
}

async function run() {
  try {
    // Get scorecards with pipedrive links
    const data = await pool.query(`
      SELECT rep_name, company_name, score, rag, pipedrive_deal_id, pipedrive_deal_stage, pipedrive_deal_value,
        score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        close_style, call_date
      FROM scorecards
      WHERE pipedrive_deal_id IS NOT NULL
    `);
    const rows = data.rows;
    console.log(`Scorecards with Pipedrive: ${rows.length}`);

    // Get unique deal IDs
    const dealIds = [...new Set(rows.map(r => r.pipedrive_deal_id))];
    console.log(`Unique deals: ${dealIds.length}`);

    // Fetch stages first
    const stagesResp = await fetch(`https://api.pipedrive.com/v1/stages`, {
      headers: { "X-Api-Token": PIPEDRIVE_KEY }
    });
    const stagesJson = await stagesResp.json();
    const stageMap = {};
    if (stagesJson.data) {
      stagesJson.data.forEach(s => {
        stageMap[s.id] = { name: s.name, pipeline_id: s.pipeline_id, order: s.order };
      });
    }

    // Fetch live deal data in parallel batches
    console.log('Fetching live deal statuses from Pipedrive...');
    const liveDeals = {};
    const batchSize = 20;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const promises = batch.map(id => fetchDeal(id));
      const results = await Promise.all(promises);
      results.forEach(d => { if (d) liveDeals[d.id] = d; });
      if (i % 100 === 0) process.stdout.write(`  ${Math.min(i + batchSize, dealIds.length)}/${dealIds.length}...`);
      await sleep(200); // rate limit
    }
    console.log(` Done. Fetched ${Object.keys(liveDeals).length} deals`);

    // Categorize by live status
    function categorizeLive(deal) {
      if (!deal) return 'unknown';
      const stageInfo = stageMap[deal.stage_id];
      const stageName = stageInfo ? stageInfo.name.toLowerCase() : '';
      const stageOrder = stageInfo ? stageInfo.order : 0;
      
      if (deal.status === 'lost') return 'lost';
      if (deal.status === 'won' || stageName.includes('closed won') || stageName.includes('signed') || stageName.includes('awaiting payment') || stageName.includes('closed/$$')) return 'won';
      if (stageName.includes('objection') || stageName.includes('working it') || stageName.includes('closing call') || stageName.includes('koc') || stageName.includes('follow up call held') || stageName.includes('interested') || stageName.includes('proposal') || stageName.includes('best case') || stageName.includes('committed')) return 'advanced';
      if (stageName.includes('demo held') || stageName.includes('demo scheduled') || stageName.includes('demo booked') || stageName.includes('follow up call booked') || stageName.includes('koc scheduled')) return 'demo_stage';
      if (stageName.includes('unqualified') || stageName.includes('email drip') || stageName.includes('long term') || stageName.includes('nurture')) return 'stalled';
      if (stageName.includes('contact') || stageName.includes('qualified') || stageName.includes('positive') || stageName.includes('needs') || stageName.includes('prospecting') || stageName.includes('discovery')) return 'early_stage';
      return 'other';
    }

    // Merge and categorize
    rows.forEach(r => {
      const deal = liveDeals[r.pipedrive_deal_id];
      r.liveStatus = deal ? deal.status : 'unknown';
      r.liveStageId = deal ? deal.stage_id : null;
      r.liveStageName = deal && stageMap[deal.stage_id] ? stageMap[deal.stage_id].name : r.pipedrive_deal_stage;
      r.liveValue = deal ? deal.value : r.pipedrive_deal_value;
      r.liveBucket = categorizeLive(deal);
    });

    const buckets = { won: [], advanced: [], demo_stage: [], early_stage: [], stalled: [], lost: [], unknown: [], other: [] };
    rows.forEach(r => buckets[r.liveBucket].push(r));

    console.log(``);
    console.log(`=== LIVE DEAL STATUS ===`);
    Object.entries(buckets).forEach(([k, v]) => {
      if (v.length) console.log(`  ${k}: ${v.length}`);
    });

    const progressed = [...buckets.advanced, ...buckets.won];
    const notProgressed = [...buckets.stalled, ...buckets.lost, ...buckets.demo_stage, ...buckets.early_stage];

    console.log(``);
    console.log(`=== PROGRESSED (advanced+won) vs NOT (stalled+lost+demo+early) ===`);
    console.log(`  Progressed: ${progressed.length} | Not Progressed: ${notProgressed.length}`);

    const metrics = [
      ['score', 'Overall Score'],
      ['score_discovery', 'Discovery'],
      ['score_presentation', 'Presentation'],
      ['score_pricing', 'Pricing/Objections'],
      ['score_closing', 'Closing'],
      ['spiced_p', 'Pain (SPICED-P)'],
      ['spiced_i', 'Impact (SPICED-I)'],
      ['spiced_c', 'Critical Event (SPICED-C)'],
      ['spiced_e', 'Decision (SPICED-E)'],
    ];

    console.log(``);
    metrics.forEach(([key, label]) => {
      const p = avg(progressed, key);
      const n = avg(notProgressed, key);
      const diff = (p != null && n != null) ? p - n : null;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
      console.log(`  ${label.padEnd(22)} Progressed=${fmt(p).padStart(6)} | Not=${fmt(n).padStart(6)} | Gap: ${arrow}${fmt(Math.abs(diff)).padStart(5)}`);
    });

    // Per-rep
    console.log(``);
    console.log(`=== PER-REP BREAKDOWN ===`);
    const reps = {};
    rows.forEach(r => {
      if (!reps[r.rep_name]) reps[r.rep_name] = [];
      reps[r.rep_name].push(r);
    });

    Object.entries(reps).sort((a, b) => b[1].length - a[1].length).forEach(([name, calls]) => {
      const prog = calls.filter(c => c.liveBucket === 'won' || c.liveBucket === 'advanced');
      const stall = calls.filter(c => c.liveBucket === 'stalled' || c.liveBucket === 'lost');
      const demo = calls.filter(c => c.liveBucket === 'demo_stage');
      const early = calls.filter(c => c.liveBucket === 'early_stage');
      const total = calls.length;
      const progressRate = total ? ((prog.length) / total * 100).toFixed(0) : 0;

      // Gap between their progressed vs stalled calls
      const progPain = avg(prog, 'spiced_p');
      const stallPain = avg([...stall, ...demo], 'spiced_p');
      const progImpact = avg(prog, 'spiced_i');
      const stallImpact = avg([...stall, ...demo], 'spiced_i');
      const progCritical = avg(prog, 'spiced_c');
      const stallCritical = avg([...stall, ...demo], 'spiced_c');
      const progDecision = avg(prog, 'spiced_e');
      const stallDecision = avg([...stall, ...demo], 'spiced_e');

      console.log(``);
      console.log(`  ${name} (${total} calls): ${progressRate}% progressed | Won:${prog.filter(c=>c.liveBucket==='won').length} Adv:${prog.filter(c=>c.liveBucket==='advanced').length} Demo:${demo.length} Stalled:${stall.length} Lost:${calls.filter(c=>c.liveBucket==='lost').length} Early:${early.length}`);
      console.log(`    Avg → Score:${fmt(avg(calls, 'score'))} Pain:${fmt(avg(calls,'spiced_p'))} Impact:${fmt(avg(calls,'spiced_i'))} Critical:${fmt(avg(calls,'spiced_c'))} Decision:${fmt(avg(calls,'spiced_e'))} Close:${fmt(avg(calls,'score_closing'))}`);
      
      if (prog.length >= 3 && (stall.length + demo.length) >= 3) {
        console.log(`    Gap (prog vs stalled+demo): Pain ${fmt(progPain)} vs ${fmt(stallPain)} | Impact ${fmt(progImpact)} vs ${fmt(stallImpact)} | Critical ${fmt(progCritical)} vs ${fmt(stallCritical)} | Decision ${fmt(progDecision)} vs ${fmt(stallDecision)}`);
      }
    });

    // Biggest differentiators
    console.log(``);
    console.log(`=== RANKED DIFFERENTIATORS (biggest gap = most predictive) ===`);
    const gaps = metrics.map(([key, label]) => ({
      label,
      progressed: avg(progressed, key),
      notProgressed: avg(notProgressed, key),
      gap: avg(progressed, key) - avg(notProgressed, key)
    })).filter(g => g.progressed != null && g.notProgressed != null).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    gaps.forEach((g, i) => {
      const arrow = g.gap > 0 ? '↑' : '↓';
      console.log(`  ${i + 1}. ${g.label.padEnd(22)} gap: ${arrow}${Math.abs(g.gap).toFixed(2)} pts (Prog=${fmt(g.progressed)}, Not=${fmt(g.notProgressed)})`);
    });

    // Close style analysis
    console.log(``);
    console.log(`=== CLOSE STYLE vs DEAL OUTCOME ===`);
    const closeStyles = {};
    rows.forEach(r => {
      const style = r.close_style || 'none';
      if (!closeStyles[style]) closeStyles[style] = { progressed: 0, stalled: 0, demo: 0, total: 0 };
      closeStyles[style].total++;
      if (r.liveBucket === 'won' || r.liveBucket === 'advanced') closeStyles[style].progressed++;
      else if (r.liveBucket === 'stalled' || r.liveBucket === 'lost') closeStyles[style].stalled++;
      else if (r.liveBucket === 'demo_stage') closeStyles[style].demo++;
    });
    Object.entries(closeStyles).sort((a, b) => b[1].total - a[1].total).forEach(([style, d]) => {
      const progRate = d.total ? (d.progressed / d.total * 100).toFixed(0) : 0;
      console.log(`  ${style.padEnd(15)} ${d.total} calls → ${progRate}% progressed, ${d.stalled} stalled, ${d.demo} at demo`);
    });

  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

run();
