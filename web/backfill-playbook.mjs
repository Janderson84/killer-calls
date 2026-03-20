import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// ─── Extraction logic (mirrors web/src/lib/playbook.ts) ────────

function extractExamples(scorecard, meta) {
  const examples = [];
  const sc = typeof scorecard === "string" ? JSON.parse(scorecard) : scorecard;

  // 1. Objection Handling — extract objections with 3+ ECIR steps
  const objections = sc.phases?.pricing?.criteria?.ecir?.objections || [];
  const ecirFeedback = sc.phases?.pricing?.criteria?.ecir?.feedback || "";
  for (const obj of objections) {
    const steps = [obj.empathize, obj.clarify, obj.isolate, obj.respond];
    const hitCount = steps.filter(Boolean).length;
    if (hitCount >= 3) {
      const stepNames = [];
      if (obj.empathize) stepNames.push("Empathize");
      if (obj.clarify) stepNames.push("Clarify");
      if (obj.isolate) stepNames.push("Isolate");
      if (obj.respond) stepNames.push("Respond");
      examples.push({
        category: "objection_handling",
        title: obj.topic || "Objection handled",
        body: `${meta.repName} handled this objection using ${stepNames.join(" → ")} (${hitCount}/4 ECIR steps).\n\n${ecirFeedback}`,
        timestamp: obj.timestamp || null,
        metadata: obj,
      });
    }
  }

  // 2. Close Execution — extract strong closes
  if (sc.close?.ask?.status === "strong" && sc.close?.style !== "none") {
    const parts = [];
    if (sc.close.setup?.feedback) parts.push(`**${sc.close.setup.label || "Setup"}**: ${sc.close.setup.feedback}`);
    if (sc.close.bridge?.feedback) parts.push(`**${sc.close.bridge.label || "Bridge"}**: ${sc.close.bridge.feedback}`);
    if (sc.close.ask?.feedback) parts.push(`**${sc.close.ask.label || "Ask"}**: ${sc.close.ask.feedback}`);
    examples.push({
      category: "close_execution",
      title: `${sc.close.styleName || sc.close.style} Close`,
      body: parts.join("\n\n"),
      timestamp: sc.close.ask?.timestamps?.[0] || null,
      metadata: sc.close,
    });
  }

  // 3. Discovery Wins — from green calls
  if (sc.rag === "green" && Array.isArray(sc.wins)) {
    for (const win of sc.wins) {
      if (!win) continue;
      examples.push({
        category: "discovery_win",
        title: win.length > 80 ? win.substring(0, 77) + "..." : win,
        body: win,
        timestamp: null,
        metadata: null,
      });
    }
  }

  // 4. Quotes — from green calls
  if (sc.rag === "green" && sc.quoteOfTheCall?.text) {
    const q = sc.quoteOfTheCall;
    examples.push({
      category: "quote",
      title: q.text.length > 80 ? q.text.substring(0, 77) + "..." : q.text,
      body: `"${q.text}"\n\n${q.context || ""}`,
      timestamp: q.timestamp || null,
      metadata: q,
    });
  }

  return examples;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("Backfilling playbook examples from existing scorecards...\n");

  const scorecards = await sql`
    SELECT id, team_id, rep_name, company_name, call_date, scorecard_json
    FROM scorecards
    WHERE scorecard_json IS NOT NULL AND team_id IS NOT NULL
    ORDER BY created_at ASC
  `;

  console.log(`Found ${scorecards.length} scorecards to process.\n`);

  let totalInserted = 0;

  for (const row of scorecards) {
    const sc = typeof row.scorecard_json === "string"
      ? JSON.parse(row.scorecard_json)
      : row.scorecard_json;

    const meta = {
      repName: row.rep_name,
      companyName: row.company_name,
      date: row.call_date,
    };

    const examples = extractExamples(sc, meta);

    if (examples.length === 0) continue;

    // Delete existing auto-extracted examples for this scorecard
    await sql`DELETE FROM playbook_examples WHERE scorecard_id = ${row.id} AND source = 'auto'`;

    for (const ex of examples) {
      await sql`
        INSERT INTO playbook_examples (
          team_id, scorecard_id, category, title, body,
          rep_name, company_name, call_date, timestamp,
          metadata, source
        ) VALUES (
          ${row.team_id}, ${row.id}, ${ex.category}, ${ex.title}, ${ex.body},
          ${meta.repName}, ${meta.companyName}, ${meta.date}, ${ex.timestamp},
          ${ex.metadata ? JSON.stringify(ex.metadata) : null}, 'auto'
        )
      `;
    }

    totalInserted += examples.length;
    console.log(`  ${row.rep_name} → ${row.company_name}: ${examples.length} examples`);
  }

  console.log(`\n✅ Done! Inserted ${totalInserted} playbook examples.`);

  // Print stats
  const stats = await sql`
    SELECT category, COUNT(*)::int as count
    FROM playbook_examples
    GROUP BY category
    ORDER BY count DESC
  `;
  console.log("\nBreakdown:");
  for (const s of stats) {
    console.log(`  ${s.category}: ${s.count}`);
  }
}

main().catch(console.error);
