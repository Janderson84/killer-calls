/**
 * Backfill close data from phases.closing for scorecards where close is missing/none
 * but phases.closing has actual scores.
 *
 * Usage: DATABASE_URL=... node backfill-close.mjs [--dry-run]
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const dryRun = process.argv.includes("--dry-run");

function detectStyle(feedback) {
  const fb = (feedback || "").toLowerCase();
  if (/assumptive|assumed|let.?s get started|here.?s how we start/i.test(fb)) {
    return { style: "assumptive", styleName: "Assumptive Close" };
  }
  if (/urgency|deadline|critical event|time.?bound|end of (quarter|month|week)/i.test(fb)) {
    return { style: "urgency", styleName: "Urgency Close" };
  }
  return { style: "consultative", styleName: "Consultative Close" };
}

const STYLE_LABELS = {
  consultative: { setup: "Summarize Value", bridge: "Surface Blockers", ask: "Ask for Commitment" },
  assumptive: { setup: "Read Buying Signals", bridge: "Smooth Transition", ask: "Lock Specific Action" },
  urgency: { setup: "Tie to Critical Event", bridge: "Build the Timeline", ask: "Propose the Plan" },
};

async function main() {
  const rows = await sql`
    SELECT id, rep_name, score, close_style, scorecard_json
    FROM scorecards
    WHERE (close_style IS NULL OR close_style = 'none')
    ORDER BY created_at DESC
  `;

  console.log(`Found ${rows.length} scorecards with missing/none close data`);

  let fixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const sc = typeof row.scorecard_json === "string" ? JSON.parse(row.scorecard_json) : row.scorecard_json;
    if (!sc) { skipped++; continue; }

    const closePhase = sc.phases?.closing?.criteria?.closeExecution
      || sc.phases?.closing?.criteria?.pushToClose;

    if (!closePhase || closePhase.score <= 0) {
      skipped++;
      continue;
    }

    const score = closePhase.score;
    const maxPts = closePhase.maxPoints || 10;
    const ratio = score / maxPts;
    const feedback = closePhase.feedback || "";
    const timestamps = closePhase.timestamps || [];

    const { style, styleName } = detectStyle(feedback);
    const labels = STYLE_LABELS[style];

    const setupStatus = ratio >= 0.7 ? "strong" : ratio >= 0.4 ? "partial" : "missing";
    const askStatus = ratio >= 0.7 ? "strong" : ratio >= 0.2 ? "partial" : "missing";

    const closeObj = {
      style,
      styleName,
      setup: { score: Math.round(ratio * 4), status: setupStatus, label: labels.setup, feedback, timestamps },
      bridge: { score: Math.round(ratio * 3), status: setupStatus, label: labels.bridge, feedback: "", timestamps: [] },
      ask: { score: Math.round(ratio * 3), status: askStatus, label: labels.ask, feedback: "", timestamps: [] },
    };

    // Update scorecard_json with the new close object
    sc.close = closeObj;

    if (dryRun) {
      console.log(`[dry-run] ${row.rep_name} (${row.score}/100) → ${styleName} (phase score: ${score}/${maxPts})`);
    } else {
      await sql`
        UPDATE scorecards
        SET close_style = ${style},
            close_setup = ${setupStatus},
            close_bridge = ${setupStatus},
            close_ask = ${askStatus},
            scorecard_json = ${JSON.stringify(sc)}::jsonb
        WHERE id = ${row.id}
      `;
    }
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped (no phase data): ${skipped}${dryRun ? " [DRY RUN]" : ""}`);
}

main().catch(console.error);
