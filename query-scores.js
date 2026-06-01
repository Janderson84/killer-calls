
require("dotenv").config({ path: "/data/workspace/killer-calls/.env" });
const fs = require("fs");
const { Pool } = require("pg");

const password = fs.readFileSync("/tmp/db-pass.txt", "utf-8").trim();
const PROD_DB = "postgresql://neondb_owner:" + password + "@ep-calm-flower-akn6rx5q-pooler.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({ connectionString: PROD_DB, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    const repScores = await pool.query(`
      SELECT rep_name, COUNT(*) as calls, ROUND(AVG(score)::numeric, 1) as avg,
             MIN(score) as min, MAX(score) as max
      FROM scorecards GROUP BY rep_name ORDER BY avg DESC;
    `);
    console.log("=== Rep Scores ===");
    repScores.rows.forEach(r =>
      console.log(r.rep_name.padEnd(25) + " calls:" + String(r.calls).padStart(3) + "  avg:" + String(r.avg).padStart(5) + "  range:" + r.min + "-" + r.max)
    );

    const trend = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') as week,
             COUNT(*) as calls, ROUND(AVG(score)::numeric, 1) as avg
      FROM scorecards WHERE created_at > NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', created_at) ORDER BY week DESC;
    `);
    console.log("\n=== Weekly Trend ===");
    trend.rows.forEach(r =>
      console.log(r.week.padEnd(10) + " calls:" + String(r.calls).padStart(3) + "  avg:" + String(r.avg).padStart(5))
    );

    const overall = await pool.query(
      "SELECT COUNT(*), ROUND(AVG(score)::numeric, 1) as avg, MIN(score) as min, MAX(score) as max FROM scorecards"
    );
    const o = overall.rows[0];
    console.log("\n=== Overall: " + o.count + " cards, avg " + o.avg + ", range " + o.min + "-" + o.max + " ===");

    const rag = await pool.query("SELECT rag, COUNT(*) FROM scorecards GROUP BY rag ORDER BY rag");
    console.log("\n=== RAG ===");
    rag.rows.forEach(r => console.log("  " + r.rag + ": " + r.count));

    const phases = await pool.query(`
      SELECT ROUND(AVG(score_pre_call)::numeric,1) as pc,
             ROUND(AVG(score_discovery)::numeric,1) as d,
             ROUND(AVG(score_presentation)::numeric,1) as pr,
             ROUND(AVG(score_pricing)::numeric,1) as pp,
             ROUND(AVG(score_closing)::numeric,1) as cl
      FROM scorecards;
    `);
    const p = phases.rows[0];
    console.log("\n=== Phase Averages (out of max) ===");
    console.log("  Pre-Call Prep:   " + p.pc + " / 6");
    console.log("  Discovery:       " + p.d + " / 32");
    console.log("  Presentation:    " + p.pr + " / 22");
    console.log("  Pricing/Obj:     " + p.pp + " / 28");
    console.log("  Close/Nxt Steps: " + p.cl + " / 12");

  } catch (e) {
    console.error(e);
  }
  await pool.end();
})();
