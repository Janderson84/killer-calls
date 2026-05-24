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
function fmtPct(n, total) { return total ? (n / total * 100).toFixed(0) + '%' : '0%'; }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDeal(dealId) {
  try {
    const resp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${PIPEDRIVE_KEY}`);
    const json = await resp.json();
    if (json.success && json.data) {
      return { id: json.data.id, status: json.data.status, stage_id: json.data.stage_id, value: json.data.value, pipeline_id: json.data.pipeline_id };
    }
  } catch (e) {}
  return null;
}

// Stage categorization by ID - maps every stage to a progression bucket
function categorizeByStageId(stageId, dealStatus, pipelineId) {
  if (dealStatus === 'lost') return 'lost';
  if (dealStatus === 'won') return 'won';
  if (!stageId) return 'unknown';

  // Pipeline 12 (Sales Pipeline) - main
  const p12 = {
    52: 'early', 55: 'early', 54: 'early', 79: 'demo', 158: 'advanced',
    463: 'advanced', 292: 'stalled', 291: 'advanced', 187: 'advanced',
    188: 'won', 159: 'won', 277: 'stalled'
  };
  // Pipeline 70 (SC Enterprise)
  const p70 = {
    474: 'early', 487: 'demo', 475: 'early', 476: 'advanced',
    477: 'advanced', 478: 'advanced', 479: 'won', 481: 'lost'
  };
  // Pipeline 59 (SalesCloser SC)
  const p59 = {
    370: 'early', 371: 'early', 372: 'early', 373: 'demo', 374: 'stalled',
    375: 'advanced', 396: 'advanced', 397: 'advanced', 398: 'won', 399: 'won', 468: 'stalled'
  };
  // Pipeline 60
  const p60 = {
    376: 'early', 377: 'early', 378: 'early', 379: 'demo', 380: 'stalled',
    393: 'advanced', 394: 'advanced', 395: 'won'
  };
  // Pipeline 22 (Chat)
  const p22 = {
    102: 'early', 103: 'early', 104: 'demo', 107: 'demo', 141: 'advanced',
    108: 'advanced', 105: 'advanced', 106: 'won'
  };
  // Pipeline 11
  const p11 = {
    46: 'early', 47: 'early', 48: 'early', 49: 'demo', 140: 'advanced',
    50: 'advanced', 51: 'advanced', 82: 'won'
  };
  // Pipeline 18/17
  const p17_18 = {
    74: 'early', 75: 'early', 76: 'advanced', 77: 'advanced', 78: 'won',
    69: 'early', 70: 'early', 71: 'advanced', 72: 'advanced', 73: 'won'
  };
  // Pipeline 3
  const p3 = { 429: 'demo', 10: 'early', 11: 'early', 12: 'demo', 13: 'advanced' };
  // Pipeline 67 (SC AI)
  const p67 = {
    446: 'demo', 447: 'demo', 448: 'advanced', 449: 'advanced', 450: 'advanced', 451: 'won'
  };
  // Pipeline 68
  const p68 = {
    457: 'early', 458: 'demo', 459: 'demo', 462: 'stalled', 461: 'advanced', 460: 'won'
  };
  // Pipeline 31
  const p31 = { 142: 'demo', 143: 'early', 144: 'demo', 147: 'advanced' };
  // Pipeline 69
  const p69 = { 469: 'early', 470: 'early', 471: 'demo', 472: 'advanced', 473: 'advanced' };
  // Pipeline 37
  const p37 = {
    182: 'early', 183: 'early', 184: 'early', 185: 'demo', 289: 'stalled',
    225: 'advanced', 226: 'advanced'
  };

  const stageMaps = { 12: p12, 70: p70, 59: p59, 60: p60, 22: p22, 11: p11, 18: p17_18, 17: p17_18, 3: p3, 67: p67, 68: p68, 31: p31, 69: p69, 37: p37 };
  const map = stageMaps[pipelineId];
  if (map && map[stageId]) return map[stageId];

  // Fallback: use stage name heuristics
  return null;
}

async function run() {
  try {
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

    const dealIds = [...new Set(rows.map(r => r.pipedrive_deal_id))];
    console.log(`Unique deals: ${dealIds.length}`);

    // Fetch live deals
    console.log('Fetching live deal statuses...');
    const liveDeals = {};
    const batchSize = 20;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const promises = batch.map(id => fetchDeal(id));
      const results = await Promise.all(promises);
      results.forEach(d => { if (d) liveDeals[d.id] = d; });
      await sleep(200);
    }
    console.log(`Fetched ${Object.keys(liveDeals).length} live deals (${dealIds.length - Object.keys(liveDeals).length} deleted/archived)`);

    // Categorize
    rows.forEach(r => {
      const deal = liveDeals[r.pipedrive_deal_id];
      if (deal) {
        r.liveBucket = categorizeByStageId(deal.stage_id, deal.status, deal.pipeline_id) || 'other';
        r.liveStatus = deal.status;
        r.liveValue = deal.value;
      } else {
        r.liveBucket = 'deleted';
        r.liveStatus = 'unknown';
      }
    });

    const buckets = { won: [], advanced: [], demo: [], early: [], stalled: [], lost: [], deleted: [], other: [] };
    rows.forEach(r => buckets[r.liveBucket].push(r));

    console.log(``);
    console.log(`=== DEAL OUTCOME DISTRIBUTION (live) ===`);
    Object.entries(buckets).forEach(([k, v]) => {
      if (v.length) console.log(`  ${k.padEnd(10)} ${v.length} calls (${fmtPct(v.length, rows.length)})`);
    });

    const progressed = [...buckets.won, ...buckets.advanced];
    const stuck = [...buckets.stalled, ...buckets.lost, ...buckets.demo, ...buckets.early];
    const active = rows.filter(r => r.liveBucket !== 'deleted' && r.liveBucket !== 'other');

    console.log(``);
    console.log(`============================================================`);
    console.log(`  PROGRESSED (won+advanced) vs STUCK (stalled+lost+demo+early)`);
    console.log(`  Progressed: ${progressed.length} | Stuck: ${stuck.length} | Total active: ${active.length}`);
    console.log(`============================================================`);

    const metrics = [
      ['score', 'Overall Score (100)'],
      ['score_discovery', 'Discovery Phase (32)'],
      ['score_presentation', 'Presentation (22)'],
      ['score_pricing', 'Pricing & Objections (28)'],
      ['score_closing', 'Close & Next Steps (12)'],
      ['spiced_p', 'Pain Identified (5)'],
      ['spiced_i', 'Impact Quantified (5)'],
      ['spiced_c', 'Critical Event (5)'],
      ['spiced_e', 'Decision Mapped (5)'],
    ];

    console.log(``);
    metrics.forEach(([key, label]) => {
      const p = avg(progressed, key);
      const s = avg(stuck, key);
      const diff = (p != null && s != null) ? p - s : null;
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '=';
      const pctDiff = (p != null && s != null && s > 0) ? ((diff / s) * 100).toFixed(0) : 'N/A';
      console.log(`  ${label.padEnd(28)} Prog=${fmt(p).padStart(6)}  Stuck=${fmt(s).padStart(6)}  Gap: ${arrow}${fmt(Math.abs(diff)).padStart(5)} (${pctDiff}%)`);
    });

    // Per-rep
    console.log(``);
    console.log(`=== PER-REP: PROGRESSION RATE + SCORE GAPS ===`);
    const reps = {};
    rows.forEach(r => {
      if (!reps[r.rep_name]) reps[r.rep_name] = [];
      reps[r.rep_name].push(r);
    });

    Object.entries(reps).sort((a, b) => b[1].length - a[1].length).forEach(([name, calls]) => {
      const prog = calls.filter(c => c.liveBucket === 'won' || c.liveBucket === 'advanced');
      const demo = calls.filter(c => c.liveBucket === 'demo');
      const stall = calls.filter(c => c.liveBucket === 'stalled' || c.liveBucket === 'lost');
      const total = calls.length;
      const progRate = total ? (prog.length / total * 100).toFixed(0) : 0;

      console.log(``);
      console.log(`  ${name} (${total} calls)`);
      console.log(`    Outcome: Won:${prog.filter(c=>c.liveBucket==='won').length} Adv:${prog.filter(c=>c.liveBucket==='advanced').length} Demo:${demo.length} Stalled:${stall.filter(c=>c.liveBucket==='stalled').length} Lost:${stall.filter(c=>c.liveBucket==='lost').length} | ${progRate}% progressed`);
      console.log(`    Averages: Score:${fmt(avg(calls,'score'))} Pain:${fmt(avg(calls,'spiced_p'))} Impact:${fmt(avg(calls,'spiced_i'))} Critical:${fmt(avg(calls,'spiced_c'))} Decision:${fmt(avg(calls,'spiced_e'))} Close:${fmt(avg(calls,'score_closing'))}`);

      // Show gap between their progressed and stuck calls
      const stuckCalls = [...stall, ...demo];
      if (prog.length >= 3 && stuckCalls.length >= 3) {
        const gaps = [
          ['score', 'Score'],
          ['spiced_p', 'Pain'],
          ['spiced_i', 'Impact'],
          ['spiced_c', 'Critical'],
          ['spiced_e', 'Decision'],
          ['score_closing', 'Close'],
          ['score_pricing', 'Pricing'],
        ];
        const gapStr = gaps.map(([k, l]) => {
          const pV = avg(prog, k);
          const sV = avg(stuckCalls, k);
          const d = (pV != null && sV != null) ? pV - sV : null;
          return d != null ? `${l}:${d > 0 ? '+' : ''}${d.toFixed(1)}` : '';
        }).filter(Boolean).join(' | ');
        console.log(`    Prog vs Stuck gap: ${gapStr}`);
      }
    });

    // Biggest differentiators ranked
    console.log(``);
    console.log(`=== RANKED PREDICTORS (by gap magnitude) ===`);
    const gaps = metrics.map(([key, label]) => ({
      label, key,
      progressed: avg(progressed, key),
      stuck: avg(stuck, key),
      gap: avg(progressed, key) - avg(stuck, key)
    })).filter(g => g.progressed != null && g.stuck != null).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    gaps.forEach((g, i) => {
      const arrow = g.gap > 0 ? '↑' : '↓';
      const pctDiff = g.stuck > 0 ? ((g.gap / g.stuck) * 100).toFixed(0) : 'N/A';
      console.log(`  ${i+1}. ${g.label.padEnd(28)} gap: ${arrow}${Math.abs(g.gap).toFixed(2)} (${pctDiff}%)`);
    });

    // Close style
    console.log(``);
    console.log(`=== CLOSE STYLE EFFECTIVENESS ===`);
    const closeStyles = {};
    active.forEach(r => {
      const style = r.close_style || 'none';
      if (!closeStyles[style]) closeStyles[style] = { progressed: 0, stuck: 0, total: 0 };
      closeStyles[style].total++;
      if (r.liveBucket === 'won' || r.liveBucket === 'advanced') closeStyles[style].progressed++;
      else closeStyles[style].stuck++;
    });
    Object.entries(closeStyles).sort((a, b) => b[1].total - a[1].total).forEach(([style, d]) => {
      const progRate = d.total ? (d.progressed / d.total * 100).toFixed(0) : 0;
      console.log(`  ${(style || 'none').padEnd(15)} ${d.total} calls → ${progRate}% progressed (${d.progressed}/${d.total})`);
    });

    // Deal value vs score
    const withValue = active.filter(r => r.liveValue && parseFloat(r.liveValue) > 0);
    if (withValue.length > 10) {
      const sorted = withValue.sort((a, b) => parseFloat(b.liveValue) - parseFloat(a.liveValue));
      const top25 = sorted.slice(0, Math.ceil(sorted.length * 0.25));
      const bot25 = sorted.slice(-Math.ceil(sorted.length * 0.25));
      console.log(``);
      console.log(`=== DEAL VALUE vs CALL QUALITY ===`);
      console.log(`  Top 25% value ($${parseFloat(top25[0].liveValue).toLocaleString()}+): Score=${fmt(avg(top25,'score'))}, Pain=${fmt(avg(top25,'spiced_p'))}, Impact=${fmt(avg(top25,'spiced_i'))}`);
      console.log(`  Bottom 25% value ($${parseFloat(bot25[bot25.length-1].liveValue).toLocaleString()}-): Score=${fmt(avg(bot25,'score'))}, Pain=${fmt(avg(bot25,'spiced_p'))}, Impact=${fmt(avg(bot25,'spiced_i'))}`);
    }

  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

run();
