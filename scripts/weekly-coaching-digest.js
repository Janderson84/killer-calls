#!/usr/bin/env node
require("dotenv").config();

const { Pool } = require("pg");
const { WebClient } = require("@slack/web-api");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_REVIEWS;

const STATUS_MAP = { strong: 3, partial: 2, weak: 1, missing: 0, none: 0 };

function statusToNum(val) {
  if (val == null) return null;
  return STATUS_MAP[String(val).toLowerCase().trim()] ?? null;
}

function avg(arr, key) {
  const vals = arr
    .map((r) => r[key])
    .filter((v) => v != null)
    .map((v) => (typeof v === "number" ? v : statusToNum(v)))
    .filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function fmt(v) {
  return v != null ? v.toFixed(2) : "N/A";
}

function fmtPct(n, total) {
  return total ? (n / total * 100).toFixed(0) + "%" : "0%";
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Stage categorization (same as deal-progression-analysis.js)
function categorizeByStageId(stageId, dealStatus, pipelineId) {
  if (dealStatus === "lost") return "lost";
  if (dealStatus === "won") return "won";
  if (!stageId) return "unknown";

  const p12 = { 52: "early", 55: "early", 54: "early", 79: "demo", 158: "advanced", 463: "advanced", 292: "stalled", 291: "advanced", 187: "advanced", 188: "won", 159: "won", 277: "stalled" };
  const p70 = { 474: "early", 487: "demo", 475: "early", 476: "advanced", 477: "advanced", 478: "advanced", 479: "won", 481: "lost" };
  const p59 = { 370: "early", 371: "early", 372: "early", 373: "demo", 374: "stalled", 375: "advanced", 396: "advanced", 397: "advanced", 398: "won", 399: "won", 468: "stalled" };
  const p60 = { 376: "early", 377: "early", 378: "early", 379: "demo", 380: "stalled", 393: "advanced", 394: "advanced", 395: "won" };
  const p22 = { 102: "early", 103: "early", 104: "demo", 107: "demo", 141: "advanced", 108: "advanced", 105: "advanced", 106: "won" };
  const p11 = { 46: "early", 47: "early", 48: "early", 49: "demo", 140: "advanced", 50: "advanced", 51: "advanced", 82: "won" };
  const p17_18 = { 74: "early", 75: "early", 76: "advanced", 77: "advanced", 78: "won", 69: "early", 70: "early", 71: "advanced", 72: "advanced", 73: "won" };
  const p3 = { 429: "demo", 10: "early", 11: "early", 12: "demo", 13: "advanced" };
  const p67 = { 446: "demo", 447: "demo", 448: "advanced", 449: "advanced", 450: "advanced", 451: "won" };
  const p68 = { 457: "early", 458: "demo", 459: "demo", 462: "stalled", 461: "advanced", 460: "won" };
  const p31 = { 142: "demo", 143: "early", 144: "demo", 147: "advanced" };
  const p69 = { 469: "early", 470: "early", 471: "demo", 472: "advanced", 473: "advanced" };
  const p37 = { 182: "early", 183: "early", 184: "early", 185: "demo", 289: "stalled", 225: "advanced", 226: "advanced" };

  const stageMaps = { 12: p12, 70: p70, 59: p59, 60: p60, 22: p22, 11: p11, 18: p17_18, 17: p17_18, 3: p3, 67: p67, 68: p68, 31: p31, 69: p69, 37: p37 };
  const map = stageMaps[pipelineId];
  if (map && map[stageId]) return map[stageId];
  return null;
}

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

// AE roster with Slack IDs
const AE_ROSTER = [
  { name: "Pedro Cavagnari", email: "pedro.c@salescloser.ai", slack: "U0A7HQWP3GU" },
  { name: "Edgar Arana", email: "edgar.a@salescloser.ai", slack: "U0A6YPUEB7H" },
  { name: "Marc Beauchamp", email: "marc.b@salescloser.ai", slack: "U0A7T59MFCZ" },
  { name: "Alfred Du", email: "alfred.d@salescloser.ai", slack: "U0A7T58JVHP" },
  { name: "Vanessa Fortune", email: "vanessa.f@salescloser.ai", slack: "U0A7T58H2MP" },
  { name: "Gleidson Rocha", email: "gleidson.r@salescloser.ai", slack: "U0A88GBQQQ0" },
  { name: "David Morawietz", email: "david.m@salescloser.ai", slack: "U0A89DVTWQ1" },
  { name: "Donavyn Meadows", email: "donavyn.m@salescloser.ai", slack: "PLACEHOLDER" },
];

// Map rep_name variations to roster entries
function findRosterEntry(repName) {
  if (!repName) return null;
  const lower = repName.toLowerCase();
  return AE_ROSTER.find((ae) => {
    const parts = ae.name.toLowerCase().split(" ");
    return lower.includes(parts[0]) || lower.includes(parts[1] || "") || lower === ae.name.toLowerCase();
  });
}

async function run() {
  try {
    // Fetch all scorecards with Pipedrive links
    const data = await pool.query(`
      SELECT rep_name, company_name, score, rag, pipedrive_deal_id,
        score_discovery, score_presentation, score_pricing, score_closing,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        close_style, call_date
      FROM scorecards
      WHERE pipedrive_deal_id IS NOT NULL
    `);
    const rows = data.rows;
    console.log(`Scorecards with Pipedrive: ${rows.length}`);

    // Fetch live deal statuses
    const dealIds = [...new Set(rows.map((r) => r.pipedrive_deal_id))];
    console.log(`Fetching ${dealIds.length} live deals...`);
    const liveDeals = {};
    const batchSize = 10;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const promises = batch.map((id) => fetchDeal(id));
      const results = await Promise.all(promises);
      results.forEach((d) => { if (d) liveDeals[d.id] = d; });
      await sleep(500);
    }
    console.log(`Fetched ${Object.keys(liveDeals).length} live deals`);

    // Categorize each call
    rows.forEach((r) => {
      const deal = liveDeals[r.pipedrive_deal_id];
      if (deal) {
        r.liveBucket = categorizeByStageId(deal.stage_id, deal.status, deal.pipeline_id) || "other";
        r.liveStatus = deal.status;
      } else {
        r.liveBucket = "deleted";
        r.liveStatus = "unknown";
      }
    });

    // Team averages for key predictive criteria
    const active = rows.filter((r) => r.liveBucket !== "deleted" && r.liveBucket !== "other");
    const teamAvg = {
      score: avg(active, "score"),
      spiced_i: avg(active, "spiced_i"),
      spiced_c: avg(active, "spiced_c"),
      spiced_e: avg(active, "spiced_e"),
      score_closing: avg(active, "score_closing"),
      score_pricing: avg(active, "score_pricing"),
      score_discovery: avg(active, "score_discovery"),
    };

    // Group by rep
    const reps = {};
    rows.forEach((r) => {
      if (!reps[r.rep_name]) reps[r.rep_name] = [];
      reps[r.rep_name].push(r);
    });

    // Key predictive criteria labels
    const keyCriteria = [
      { key: "spiced_i", label: "Impact", shortLabel: "Impact (I)" },
      { key: "spiced_c", label: "Critical Event", shortLabel: "Critical Event (C)" },
      { key: "spiced_e", label: "Decision Mapped", shortLabel: "Decision (E)" },
      { key: "score_closing", label: "Close & Next Steps", shortLabel: "Close" },
      { key: "score_pricing", label: "Pricing & Objections", shortLabel: "Pricing" },
      { key: "score_discovery", label: "Discovery", shortLabel: "Discovery" },
    ];

    // Find top closed deals for "What Good Looks Like"
    const wonCalls = rows.filter((r) => r.liveBucket === "won").sort((a, b) => b.score - a.score);
    const topWon = wonCalls.slice(0, 2);

    // Build Slack blocks
    const slack = new WebClient(SLACK_TOKEN);
    const today = new Date();
    const weekStr = `Week of ${today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `Weekly Coaching Digest | ${weekStr}`, emoji: true }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Based on *${active.length}* scored calls linked to Pipedrive. Progressed = deal won or advanced. Stuck = stalled, lost, or still in early stages.`
        }
      },
      { type: "divider" }
    ];

    // What Good Looks Like section
    if (topWon.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*What Good Looks Like*"
        }
      });
      for (const call of topWon) {
        let sc = null;
        try {
          const scRow = await pool.query("SELECT scorecard_json->spiced as spiced_data FROM scorecards WHERE rep_name = $1 AND company_name = $2 AND score = $3 LIMIT 1", [call.rep_name, call.company_name, call.score]);
        } catch (e) {}
        const spicedStr = ["s", "p", "i", "c", "e"].map((el) => {
          const val = call[`spiced_${el}`] || "missing";
          const icon = val === "strong" ? "G" : val === "partial" ? "Y" : "R";
          return `${el.toUpperCase()}:${icon}`;
        }).join(" ");
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${call.rep_name}* -> ${call.company_name} | *${call.score}/100* | SPICED: ${spicedStr}`
          }
        });
      }
      blocks.push({ type: "divider" });
    }

    // Per-AE section
    const sortedReps = Object.entries(reps).sort((a, b) => {
      const aActive = a[1].filter((r) => r.liveBucket !== "deleted" && r.liveBucket !== "other");
      const bActive = b[1].filter((r) => r.liveBucket !== "deleted" && r.liveBucket !== "other");
      const aProg = aActive.filter((r) => r.liveBucket === "won" || r.liveBucket === "advanced").length;
      const bProg = bActive.filter((r) => r.liveBucket === "won" || r.liveBucket === "advanced").length;
      const aRate = aActive.length ? aProg / aActive.length : 0;
      const bRate = bActive.length ? bProg / bActive.length : 0;
      return bRate - aRate;
    });

    for (const [name, calls] of sortedReps) {
      const activeCalls = calls.filter((r) => r.liveBucket !== "deleted" && r.liveBucket !== "other");
      const progressed = activeCalls.filter((r) => r.liveBucket === "won" || r.liveBucket === "advanced");
      const stuck = activeCalls.filter((r) => r.liveBucket === "stalled" || r.liveBucket === "lost" || r.liveBucket === "demo" || r.liveBucket === "early");
      const progRate = activeCalls.length ? (progressed.length / activeCalls.length * 100).toFixed(0) : 0;
      const entry = findRosterEntry(name);
      const mention = entry ? `<@${entry.slack}>` : name;

      // Rep averages for key criteria
      const repAvg = {};
      for (const c of keyCriteria) {
        repAvg[c.key] = avg(activeCalls, c.key);
      }

      // Gap between progressed vs stuck calls for this rep
      const gaps = [];
      for (const c of keyCriteria) {
        const pVal = avg(progressed, c.key);
        const sVal = avg(stuck, c.key);
        if (pVal != null && sVal != null) {
          const diff = pVal - sVal;
          gaps.push({ key: c.key, label: c.label, shortLabel: c.shortLabel, diff, absDiff: Math.abs(diff) });
        }
      }
      gaps.sort((a, b) => b.absDiff - a.absDiff);
      const top3Gaps = gaps.slice(0, 3);

      // Coaching recommendation based on biggest gap
      const biggestGap = top3Gaps[0];
      let coaching = "";
      if (biggestGap) {
        const coachingMap = {
          spiced_i: "Quantify the dollar impact of the pain you hear. Ask: what does this problem cost you per month?",
          spiced_c: "Create urgency by tying next steps to a real business deadline. Ask: is there a date this needs to be solved by?",
          spiced_e: "Map the full buying process. Ask: who else needs to weigh in, and what does approval look like on your end?",
          score_closing: "Practice closing with a clear ask. Your progressed deals had stronger closes than your stuck ones.",
          score_pricing: "Anchor value before price. Summarize what they get before showing the number.",
          score_discovery: "Deepen discovery before demoing. Your strongest deals had more thorough discovery.",
        };
        coaching = coachingMap[biggestGap.key] || `Focus on ${biggestGap.label} to move more deals forward.`;
      }

      // Compare rep vs team
      const vsTeam = keyCriteria.map((c) => {
        const rVal = repAvg[c.key];
        const tVal = teamAvg[c.key];
        if (rVal != null && tVal != null) {
          const diff = rVal - tVal;
          const icon = diff > 0.2 ? "G" : diff < -0.2 ? "R" : "Y";
          return `${c.shortLabel.split(" ")[0]}:${icon}`;
        }
        return null;
      }).filter(Boolean).join(" ");

      const rateIcon = progRate >= 40 ? "G" : progRate >= 25 ? "Y" : "R";

      let repText = `*${mention}* | ${activeCalls.length} calls | ${rateIcon === "G" ? "G" : rateIcon === "Y" ? "Y" : "R"} ${progRate}% progressed | vs Team: ${vsTeam}`;

      if (top3Gaps.length > 0) {
        const gapStr = top3Gaps
          .map((g) => `${g.shortLabel}: ${g.diff > 0 ? "+" : ""}${g.diff.toFixed(1)}`)
          .join(" | ");
        repText += `

  *Biggest gaps (prog vs stuck):* ${gapStr}`;
      }

      if (coaching) {
        repText += `

  *Coaching focus:* ${coaching}`;
      }

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: repText }
      });
    }

    // Post to Slack
    try {
      const result = await slack.chat.postMessage({
        channel: SLACK_CHANNEL,
        text: `Weekly Coaching Digest | ${weekStr}`,
        blocks,
        unfurl_links: false
      });
      console.log(`Posted coaching digest to Slack: ${result.ts}`);
    } catch (err) {
      console.error(`Slack post error: ${err.message}`);
    }
  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  } finally {
    await pool.end();
  }
}

run();
