// ─── Close Rate Tracker v5 ──────────────────────────────────────
// Two independent counts per window:
//   Demos held = deals that entered Demo Held stage in this window
//   Won = deals closed (won_time) in this window
// Ratio = won / held, regardless of whether they're the same deals.
//
// Demo held date uses stage_change_time (last stage change).
// For deals currently IN Demo Held (404/444), this IS the entry time.
// For deals past it, it's approximate but directionally correct.

const https = require('https');
const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY || '7b3c82bfe78415023d00cf25faf350e3f3763f2e';
const BASE = 'https://api.pipedrive.com/v1';

const AE_USERS = {
  24018401: 'Pedro Cavagnari',
  23013309: 'Edgar Arana',
  23221451: 'Alfred Du',
  23019469: 'David Morawietz',
  22704209: 'Vanessa Fortune',
  22892595: 'Gleidson Rocha',
  22608619: 'Marc James Beauchamp',
  25464241: 'Donavyn Meadows',
};

const DEMO_HELD_STAGES = new Set([404, 444, 455]);
const CLOSED_WON_STAGES = new Set([465, 488]);
const PAST_DEMO_STAGES = new Set([405, 407, 416, 417, 427, 442, 443, 445, 466, 467]);

function pipedriveGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_token=${PIPEDRIVE_KEY}&limit=500`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function fetchAeDeals(userId) {
  const cutoff = daysAgo(120);
  let allDeals = [];
  let start = 0;
  let hasMore = true;

  while (hasMore && start < 2000) {
    const resp = await pipedriveGet(
      `/deals?user_id=${userId}&status=all_not_deleted&sort=add_time%20DESC&start=${start}`
    );
    const rawBatch = resp.data || [];
    const batch = rawBatch.filter(d => {
      const added = d.add_time ? d.add_time.split(' ')[0] : '';
      return added >= cutoff;
    });
    allDeals.push(...batch);

    const lastDeal = rawBatch[rawBatch.length - 1];
    if (lastDeal) {
      const la = lastDeal.add_time ? lastDeal.add_time.split(' ')[0] : '';
      if (la < cutoff) hasMore = false;
    }
    hasMore = hasMore && (resp.additional_data?.pagination?.more_items_in_collection || false);
    start += rawBatch.length;
    if (rawBatch.length < 500) hasMore = false;
  }

  return allDeals;
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.error('[close-rate] Fetching per AE...');

  const windows = {
    '7d': { since: daysAgo(7), held: {}, won: {} },
    '30d': { since: daysAgo(30), held: {}, won: {} },
    '90d': { since: daysAgo(90), held: {}, won: {} },
  };

  // Init counters
  for (const uid of Object.keys(AE_USERS)) {
    for (const w of Object.values(windows)) {
      w.held[uid] = 0;
      w.won[uid] = 0;
    }
  }

  for (const [userId, repName] of Object.entries(AE_USERS)) {
    const deals = await fetchAeDeals(parseInt(userId));
    console.error(`[close-rate] ${repName}: ${deals.length} deals`);

    for (const deal of deals) {
      const sid = deal.stage_id;
      const isWon = deal.status === 'won' || CLOSED_WON_STAGES.has(sid);
      const isPastDemo = DEMO_HELD_STAGES.has(sid) || PAST_DEMO_STAGES.has(sid) ||
        CLOSED_WON_STAGES.has(sid) || deal.status === 'won' || deal.status === 'lost';

      // ── DEMOS HELD: use stage_change_time ──
      if (isPastDemo) {
        const heldDate = (deal.stage_change_time || deal.update_time || deal.add_time || '').split(' ')[0];
        if (heldDate) {
          for (const [label, w] of Object.entries(windows)) {
            if (heldDate >= w.since) w.held[userId]++;
          }
        }
      }

      // ── WON: use won_time ──
      if (isWon && deal.won_time) {
        const wonDate = deal.won_time.split(' ')[0];
        for (const [label, w] of Object.entries(windows)) {
          if (wonDate >= w.since) w.won[userId]++;
        }
      }
    }
  }

  // ─── Compute ────────────────────────────────────────────────

  function pct(won, held) {
    if (held === 0) return 'N/A';
    return (won / held * 100).toFixed(1) + '%';
  }

  // Team totals
  const team = {};
  for (const [label, w] of Object.entries(windows)) {
    let tHeld = 0, tWon = 0;
    for (const uid of Object.keys(AE_USERS)) {
      tHeld += w.held[uid];
      tWon += w.won[uid];
    }
    team[label] = { held: tHeld, won: tWon, closeRate: pct(tWon, tHeld) };
  }

  const t7w = team['7d'].held > 0 ? team['7d'].won / team['7d'].held : null;
  const t30w = team['30d'].held > 0 ? team['30d'].won / team['30d'].held : null;
  let teamTrend = '→';
  if (t7w !== null && t30w !== null) {
    const diff = t7w - t30w;
    if (diff > 0.03) teamTrend = '↑';
    else if (diff < -0.03) teamTrend = '↓';
  }

  const reps = [];
  for (const uid of Object.keys(AE_USERS)) {
    const d7h = windows['7d'].held[uid], d7w = windows['7d'].won[uid];
    const d30h = windows['30d'].held[uid], d30w = windows['30d'].won[uid];
    const d90h = windows['90d'].held[uid], d90w = windows['90d'].won[uid];

    const r7 = d7h > 0 ? d7w / d7h : null;
    const r30 = d30h > 0 ? d30w / d30h : null;

    let trend = '→';
    if (r7 !== null && r30 !== null) {
      const diff = r7 - r30;
      if (diff > 0.03) trend = '↑';
      else if (diff < -0.03) trend = '↓';
    }

    reps.push({
      name: AE_USERS[uid],
      '7d': { held: d7h, won: d7w, rate: pct(d7w, d7h) },
      '30d': { held: d30h, won: d30w, rate: pct(d30w, d30h) },
      '90d': { held: d90h, won: d90w, rate: pct(d90w, d90h) },
      trend,
    });
  }

  reps.sort((a, b) => {
    if (a.trend === '↓' && b.trend !== '↓') return -1;
    if (b.trend === '↓' && a.trend !== '↓') return 1;
    const ar = a['7d'].rate === 'N/A' ? -1 : parseFloat(a['7d'].rate);
    const br = b['7d'].rate === 'N/A' ? -1 : parseFloat(b['7d'].rate);
    return ar - br;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    methodology: 'Held = stage_change_time in window (deals past Demo Held). Won = won_time in window. Independent counts.',
    team: { ...team, trend: teamTrend },
    reps,
  };

  console.log(JSON.stringify(output, null, 2));

  // ─── Console ────────────────────────────────────────────────

  console.error('\n═══════════════════════════════════════════');
  console.error('  CLOSE RATE DASHBOARD');
  console.error(`  ${new Date().toLocaleDateString()}`);
  console.error('  Closes / Demos held — same window, any deals');
  console.error('═══════════════════════════════════════════');
  console.error(`\n  TEAM ${teamTrend}:`);
  console.error(`    7d:  ${team['7d'].closeRate}  (${team['7d'].won} closes / ${team['7d'].held} held)`);
  console.error(`    30d: ${team['30d'].closeRate}  (${team['30d'].won} closes / ${team['30d'].held} held)`);
  console.error(`    90d: ${team['90d'].closeRate}  (${team['90d'].won} closes / ${team['90d'].held} held)`);
  if (t7w !== null) {
    const gap = (15 - t7w * 100).toFixed(1);
    const label = parseFloat(gap) > 0 ? `⚠️ ${gap}pts below 15%` : `✅ ${Math.abs(parseFloat(gap))}pts above 15%`;
    console.error(`    Target: 15%  ${label}`);
  }
  console.error('\n  ── REPS ──');
  console.error(`  ${'Name'.padEnd(20)} ${'T'.padEnd(3)} ${'7d'.padEnd(16)} ${'30d'.padEnd(16)} ${'90d'.padEnd(16)}`);
  console.error(`  ${'─'.repeat(70)}`);
  for (const r of reps) {
    const flag = r.trend === '↓' ? '⚠️ ' : r.trend === '↑' ? '✨ ' : '  ';
    const d7 = `${r['7d'].rate} (${r['7d'].won}W/${r['7d'].held}H)`;
    const d30 = `${r['30d'].rate} (${r['30d'].won}W/${r['30d'].held}H)`;
    const d90 = `${r['90d'].rate} (${r['90d'].won}W/${r['90d'].held}H)`;
    console.error(`  ${r.name.padEnd(20)} ${flag}${r.trend.padEnd(1)} ${d7.padEnd(16)} ${d30.padEnd(16)} ${d90.padEnd(16)}`);
  }

  const declining = reps.filter(r => r.trend === '↓');
  if (declining.length > 0) {
    console.error('\n  ⚠️  DECLINING:');
    for (const r of declining) console.error(`     ${r.name}: 7d=${r['7d'].rate} vs 30d=${r['30d'].rate}`);
  }

  console.error('\n═══════════════════════════════════════════');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
