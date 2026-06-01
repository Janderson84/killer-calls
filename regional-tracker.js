// ─── Regional Demo Performance Tracker v3 ────────────────────────
// AE-only, stage-based show/no-show detection.
//
// Show detection:
//   Deal moved FROM "Demo Scheduled" (401/441) TO "Demo Held" (404/444) = SHOW
//   Deal has "NO SHOW - demo" activity (type 9) = NO-SHOW
//   Deal stuck in "Demo Scheduled" with past date = LIKELY NO-SHOW
//
// Pipelines: 63 (SalesCloser Outbound), 66 (SalesCloser Inbound)
// AEs only: user IDs 24018401,23013309,23221451,23019469,22704209,22892595,22608619
//
// Usage: node regional-tracker.js [--days=30]

const https = require('https');
const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY || '7b3c82bfe78415023d00cf25faf350e3f3763f2e';
const BASE = 'https://api.pipedrive.com/v1';

// ─── Constants ────────────────────────────────────────────────────

const AE_USER_IDS = new Set([
  24018401, // Pedro Cavagnari
  23013309, // Edgar Arana
  23221451, // Alfred Du
  23019469, // David Morawietz
  22704209, // Vanessa Fortune
  22892595, // Gleidson Rocha
  22608619, // Marc James Beauchamp
  25464241, // Donavyn Meadows
]);

const AE_NAMES = {
  24018401: 'Pedro Cavagnari',
  23013309: 'Edgar Arana',
  23221451: 'Alfred Du',
  23019469: 'David Morawietz',
  22704209: 'Vanessa Fortune',
  22892595: 'Gleidson Rocha',
  22608619: 'Marc James Beauchamp',
  25464241: 'Donavyn Meadows',
};

const TARGET_PIPELINES = new Set([63, 66]);

// Stage IDs
const DEMO_SCHEDULED_STAGES = new Set([401, 441]); // P63:401, P66:441
const DEMO_HELD_STAGES = new Set([404, 444]);       // P63:404, P66:444
const AI_DEMO_HELD = 455;                            // P66 AI demo
const CLOSED_STAGES = new Set([465, 488]);           // P63:465, P66:488
const LOST_STAGES = new Set([430, 439]);             // Unqualified stages

// Activity type for no-show
const NO_SHOW_ACTIVITY_TYPE = 9;

// ─── Region classification ───────────────────────────────────────

const AAA_COUNTRIES = new Set([
  'US', 'USA', 'UNITED STATES', 'CA', 'CANADA',
  'GB', 'UK', 'UNITED KINGDOM', 'ENGLAND', 'SCOTLAND', 'WALES',
  'DE', 'GERMANY', 'AU', 'AUSTRALIA',
]);

const B_TIER_COUNTRIES = new Set([
  'MX', 'MEXICO', 'BR', 'BRAZIL', 'AR', 'ARGENTINA',
  'CO', 'COLOMBIA', 'CL', 'CHILE', 'PE', 'PERU',
  'EC', 'ECUADOR', 'UY', 'URUGUAY', 'PY', 'PARAGUAY',
  'BO', 'BOLIVIA', 'VE', 'VENEZUELA', 'CR', 'COSTA RICA',
  'PA', 'PANAMA', 'DO', 'DOMINICAN REPUBLIC',
  'GT', 'GUATEMALA', 'SV', 'EL SALVADOR', 'HN', 'HONDURAS',
  'NI', 'NICARAGUA',
  'AE', 'UAE', 'UNITED ARAB EMIRATES',
  'SA', 'SAUDI ARABIA', 'QA', 'QATAR', 'KW', 'KUWAIT',
  'BH', 'BAHRAIN', 'OM', 'OMAN',
]);

const NON_DEMO_COUNTRIES = new Set([
  'IN', 'INDIA', 'EG', 'EGYPT', 'PK', 'PAKISTAN',
  'BD', 'BANGLADESH', 'NG', 'NIGERIA', 'PH', 'PHILIPPINES',
  'VN', 'VIETNAM', 'ID', 'INDONESIA',
]);

const STATE_TO_COUNTRY = {
  'AL':'US','AK':'US','AZ':'US','AR':'US','CA':'US','CO':'US','CT':'US',
  'DE':'US','FL':'US','GA':'US','HI':'US','ID':'US','IL':'US','IN':'US',
  'IA':'US','KS':'US','KY':'US','LA':'US','ME':'US','MD':'US','MA':'US',
  'MI':'US','MN':'US','MS':'US','MO':'US','MT':'US','NE':'US','NV':'US',
  'NH':'US','NJ':'US','NM':'US','NY':'US','NC':'US','ND':'US','OH':'US',
  'OK':'US','OR':'US','PA':'US','RI':'US','SC':'US','SD':'US','TN':'US',
  'TX':'US','UT':'US','VT':'US','VA':'US','WA':'US','WV':'US','WI':'US',
  'WY':'US','DC':'US',
  'ON':'CA','QC':'CA','BC':'CA','AB':'CA','MB':'CA','SK':'CA','NS':'CA',
  'NB':'CA','NL':'CA','PE':'CA','NT':'CA','YT':'CA','NU':'CA',
};

const LATAM_PHONE_CODES = ['52','54','55','56','57','51','58','593','598','595','591','506','507','503','502','504','505'];
const LATAM_TLDS = ['.mx','.br','.ar','.cl','.pe','.co','.ec','.uy','.py','.bo','.ve','.cr','.pa','.do','.gt','.sv','.hn','.ni'];

function classifyCountry(country) {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (AAA_COUNTRIES.has(c)) return 'AAA';
  if (B_TIER_COUNTRIES.has(c)) return 'B-Tier';
  if (NON_DEMO_COUNTRIES.has(c)) return 'Non-Demo';
  return null;
}

function inferRegionFromAddress(address) {
  if (!address) return null;
  const parts = address.split(/[, ]+/);
  for (const part of parts) {
    const upper = part.toUpperCase().replace(/[^A-Z]/g, '');
    if (STATE_TO_COUNTRY[upper]) {
      return STATE_TO_COUNTRY[upper] === 'US' || STATE_TO_COUNTRY[upper] === 'CA' ? 'AAA' : null;
    }
    const country = classifyCountry(part);
    if (country) return country;
  }
  if (/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(address)) return 'AAA'; // UK postcode
  if (/[A-Z]\d[A-Z]\s*\d[A-Z]\d/i.test(address)) return 'AAA'; // CA postcode
  return null;
}

function inferRegionFromPhone(phones) {
  if (!phones || !Array.isArray(phones)) return null;
  for (const p of phones) {
    const value = (p.value || '').replace(/[\s\-\(\)\+\.]/g, '');
    if (!value || value.length < 7) continue;
    for (const code of LATAM_PHONE_CODES) {
      if (value.startsWith(code)) return 'B-Tier';
    }
    if (/^971/.test(value)) return 'B-Tier';
    if (/^91/.test(value)) return 'Non-Demo';
    if (/^20/.test(value)) return 'Non-Demo';
    if (/^1/.test(value) && value.length === 11) return 'AAA';
    if (/^44/.test(value) && value.length >= 11) return 'AAA';
    if (/^49/.test(value)) return 'AAA';
    if (/^61/.test(value)) return 'AAA';
  }
  return null;
}

function inferRegionFromEmail(emails) {
  if (!emails || !Array.isArray(emails)) return null;
  for (const e of emails) {
    const domain = ((e.value || '').toLowerCase()).split('@')[1];
    if (!domain) continue;
    for (const tld of LATAM_TLDS) {
      if (domain.endsWith(tld)) return 'B-Tier';
    }
    if (domain.endsWith('.in') || domain.endsWith('.eg') || domain.endsWith('.pk') ||
        domain.endsWith('.bd') || domain.endsWith('.ng') || domain.endsWith('.ph') ||
        domain.endsWith('.vn') || domain.endsWith('.id')) return 'Non-Demo';
    if (domain.endsWith('.ca') || domain.endsWith('.co.uk') ||
        domain.endsWith('.de') || domain.endsWith('.au') || domain.endsWith('.us')) return 'AAA';
  }
  return null;
}

function getRegionForDeal(deal) {
  const COUNTRY_FIELD = '5c402095b8739d9922656d4f2d92ad16bac76df8';

  // 1. Deal Country field
  const country = classifyCountry(deal[COUNTRY_FIELD]);
  if (country) return country;

  // 2. Org address
  const org = deal.org_id;
  if (org && typeof org === 'object' && org.address) {
    const r = inferRegionFromAddress(org.address);
    if (r) return r;
  }

  // 3. Person phone
  const person = deal.person_id;
  if (person && typeof person === 'object' && person.phone) {
    const r = inferRegionFromPhone(person.phone);
    if (r) return r;
  }

  // 4. Person email
  if (person && typeof person === 'object' && person.email) {
    const r = inferRegionFromEmail(person.email);
    if (r) return r;
  }

  return 'Unknown';
}

// ─── API helpers ──────────────────────────────────────────────────

function pipedriveGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_token=${PIPEDRIVE_KEY}&limit=500`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// Fetch activities for a specific deal
function getDealActivities(dealId) {
  return pipedriveGet(`/deals/${dealId}/activities`).then(resp => resp.data || []);
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  console.error(`[regional-tracker] AE-only. Pipelines 63+66. Since ${since} (${days} days).`);

  // Fetch all deals from both pipelines
  let allDeals = [];
  for (const pipelineId of [63, 66]) {
    let hasMore = true;
    let start = 0;
    while (hasMore && start < 2000) {
      const resp = await pipedriveGet(`/deals?pipeline_id=${pipelineId}&status=all_not_deleted&sort=add_time%20DESC&start=${start}`);
      if (!resp.success) break;
      const batch = resp.data || [];
      allDeals.push(...batch);
      hasMore = resp.additional_data?.pagination?.more_items_in_collection || false;
      start += batch.length;
      if (batch.length < 500) hasMore = false;
    }
  }

  console.error(`[regional-tracker] Fetched ${allDeals.length} total deals from pipelines 63+66`);

  // Filter: AE-owned, created since cutoff, reached at least Demo Scheduled
  const aeDeals = allDeals.filter(d => {
    const userId = typeof d.user_id === 'object' ? d.user_id?.id : d.user_id;
    if (!AE_USER_IDS.has(userId)) return false;

    const added = d.add_time;
    if (!added || added < since) return false;

    // Must be in a relevant stage (Demo Scheduled or beyond)
    const stageId = d.stage_id;
    const isDemoFlow = DEMO_SCHEDULED_STAGES.has(stageId) ||
                       DEMO_HELD_STAGES.has(stageId) ||
                       stageId === AI_DEMO_HELD ||
                       CLOSED_STAGES.has(stageId) ||
                       LOST_STAGES.has(stageId) ||
                       [405, 407, 416, 417, 427, 442, 443, 445, 466, 467].includes(stageId);

    return isDemoFlow;
  });

  console.error(`[regional-tracker] ${aeDeals.length} AE-owned deals in demo flow`);

  // Classify each deal
  const results = [];
  let activityChecks = 0;

  for (const deal of aeDeals) {
    const region = getRegionForDeal(deal);
    const stageId = deal.stage_id;
    const userId = typeof deal.user_id === 'object' ? deal.user_id?.id : deal.user_id;
    const repName = AE_NAMES[userId] || deal.owner_name || 'Unknown';

    // Determine show status
    let showStatus = 'unknown';

    if (DEMO_HELD_STAGES.has(stageId) || stageId === AI_DEMO_HELD || CLOSED_STAGES.has(stageId)) {
      // Deal progressed past Demo Held → definitely showed
      showStatus = 'showed';
    } else if (DEMO_SCHEDULED_STAGES.has(stageId)) {
      // Still in Demo Scheduled — check for NO SHOW activity
      try {
        const activities = await getDealActivities(deal.id);
        activityChecks++;
        const hasNoShow = activities.some(a => a.type === 'NO SHOW - demo' || a.type_id === NO_SHOW_ACTIVITY_TYPE);
        if (hasNoShow) {
          showStatus = 'no-show';
        } else {
          showStatus = 'pending';
        }
      } catch (e) {
        showStatus = 'pending';
      }
      // Rate limit
      if (activityChecks % 10 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    } else if (LOST_STAGES.has(stageId)) {
      showStatus = 'no-show'; // Unqualified = never showed / disqualified
    }

    results.push({
      dealId: deal.id,
      title: deal.title || '',
      region,
      repName,
      stageId,
      pipelineId: deal.pipeline_id,
      status: deal.status,
      showStatus,
      value: deal.value || 0,
      addedTime: deal.add_time,
    });
  }

  // Build regional breakdown (only for showed + no-show, exclude pending)
  const regions = {};
  const initRegion = () => ({
    totalDemos: 0,
    showed: 0,
    noShows: 0,
    pending: 0,
    won: 0,
    lost: 0,
    open: 0,
    totalValue: 0,
    wonValue: 0,
    repBreakdown: {},
    showBreakdown: {}, // rep → {showed, noShow}
  });

  for (const r of results) {
    if (!regions[r.region]) regions[r.region] = initRegion();
    const reg = regions[r.region];
    reg.totalDemos++;

    if (r.showStatus === 'showed') reg.showed++;
    else if (r.showStatus === 'no-show') reg.noShows++;
    else reg.pending++;

    if (r.status === 'won') { reg.won++; reg.wonValue += r.value; }
    else if (r.status === 'lost') reg.lost++;
    else reg.open++;

    reg.totalValue += r.value;

    if (!reg.repBreakdown[r.repName]) reg.repBreakdown[r.repName] = 0;
    reg.repBreakdown[r.repName]++;

    if (!reg.showBreakdown[r.repName]) reg.showBreakdown[r.repName] = { showed: 0, noShow: 0 };
    if (r.showStatus === 'showed') reg.showBreakdown[r.repName].showed++;
    else if (r.showStatus === 'no-show') reg.showBreakdown[r.repName].noShow++;
  }

  // Compute derived metrics
  const report = {};
  for (const [region, data] of Object.entries(regions)) {
    const showed = data.showed;
    const noShows = data.noShows;
    const resolved = showed + noShows;

    report[region] = {
      totalDemos: data.totalDemos,
      pending: data.pending,
      showed,
      noShows,
      showRate: resolved > 0
        ? (showed / resolved * 100).toFixed(1) + '%' : 'N/A',
      won: data.won,
      lost: data.lost,
      open: data.open,
      closeRate: showed > 0
        ? (data.won / showed * 100).toFixed(1) + '%' : 'N/A',
      overallConversion: data.totalDemos > 0
        ? (data.won / data.totalDemos * 100).toFixed(1) + '%' : 'N/A',
      avgDealValue: data.won > 0
        ? '$' + Math.round(data.wonValue / data.won).toLocaleString() : 'N/A',
      valuePerDemo: data.totalDemos > 0
        ? '$' + Math.round(data.totalValue / data.totalDemos).toLocaleString() : 'N/A',
      repBreakdown: data.repBreakdown,
      showBreakdown: data.showBreakdown,
    };
  }

  // Print JSON
  const output = {
    period: `${days} days (since ${since})`,
    generatedAt: new Date().toISOString(),
    totalAeDeals: aeDeals.length,
    activityChecks,
    detectionMethod: 'Stage-based (Demo Scheduled→Demo Held) + NO SHOW activity (type 9)',
    aeUserIds: [...AE_USER_IDS],
    regions: report,
  };

  console.log(JSON.stringify(output, null, 2));

  // Human-readable
  console.error('\n═══════════════════════════════════════════');
  console.error('  REGIONAL DEMO PERFORMANCE (AEs Only)');
  console.error(`  Pipelines 63+66. Last ${days} days.`);
  console.error('═══════════════════════════════════════════');
  for (const [region, r] of Object.entries(report)) {
    console.error(`\n  ${region}:`);
    console.error(`    Demos: ${r.totalDemos} (${r.showed} showed, ${r.noShows} no-show, ${r.pending} pending)`);
    console.error(`    Show rate: ${r.showRate} (of resolved)`);
    console.error(`    Won/Lost/Open: ${r.won}/${r.lost}/${r.open}`);
    console.error(`    Close rate: ${r.closeRate} (won / showed)`);
    console.error(`    Overall conversion: ${r.overallConversion} (won / total demos)`);
    console.error(`    Avg won deal: ${r.avgDealValue}`);
    console.error(`    Value per demo: ${r.valuePerDemo}`);
    const reps = Object.entries(r.repBreakdown).sort((a,b) => b[1] - a[1]);
    if (reps.length > 0) {
      console.error(`    Reps: ${reps.map(([n,c]) => `${n}(${c})`).join(', ')}`);
    }
    // Show per-rep show/no-show
    for (const [rep, sb] of Object.entries(r.showBreakdown).sort()) {
      if (sb.showed + sb.noShow > 0) {
        const rate = sb.showed + sb.noShow > 0 ? (sb.showed / (sb.showed + sb.noShow) * 100).toFixed(0) : 'N/A';
        console.error(`      ${rep}: ${sb.showed}/${sb.showed + sb.noShow} showed (${rate}%)`);
      }
    }
  }
  console.error('\n═══════════════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
