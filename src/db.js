const { Pool } = require("pg");

// ─── Database Client ────────────────────────────────────────────
// Persists scorecards to Neon Postgres.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Find or create a rep ───────────────────────────────────────

async function findOrCreateRep(repName) {
  // Try to find existing rep by name
  const existing = await pool.query(
    "SELECT id FROM reps WHERE name = $1 LIMIT 1",
    [repName]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new rep
  const result = await pool.query(
    "INSERT INTO reps (name) VALUES ($1) RETURNING id",
    [repName]
  );

  return result.rows[0].id;
}

// ─── Save a scorecard ───────────────────────────────────────────

async function saveScorecard(scorecard, meta) {
  const repId = await findOrCreateRep(meta.repName);

  const result = await pool.query(
    `INSERT INTO scorecards (
      rep_id, meeting_id, title, company_name, rep_name,
      call_date, duration_minutes,
      score, rag, verdict,
      score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
      spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
      bant_b, bant_a, bant_n, bant_t,
      scorecard_json, slack_review_ts, slack_killer_ts
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7,
      $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21, $22, $23, $24,
      $25, $26, $27
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      score = EXCLUDED.score,
      rag = EXCLUDED.rag,
      verdict = EXCLUDED.verdict,
      scorecard_json = EXCLUDED.scorecard_json,
      bant_b = EXCLUDED.bant_b,
      bant_a = EXCLUDED.bant_a,
      bant_n = EXCLUDED.bant_n,
      bant_t = EXCLUDED.bant_t
    RETURNING id`,
    [
      repId,
      meta.meetingId,
      meta.title || `${meta.repName} → ${meta.companyName}`,
      meta.companyName,
      meta.repName,
      meta.date,
      meta.durationMinutes,
      scorecard.score,
      scorecard.rag,
      scorecard.verdict,
      scorecard.phases?.preCall?.score || null,
      scorecard.phases?.discovery?.score || null,
      scorecard.phases?.presentation?.score || null,
      scorecard.phases?.pricing?.score || null,
      scorecard.phases?.closing?.score || null,
      scorecard.spiced?.s?.status || null,
      scorecard.spiced?.p?.status || null,
      scorecard.spiced?.i?.status || null,
      scorecard.spiced?.c?.status || null,
      scorecard.spiced?.e?.status || null,
      scorecard.bant?.b?.status || null,
      scorecard.bant?.a?.status || null,
      scorecard.bant?.n?.status || null,
      scorecard.bant?.t?.status || null,
      JSON.stringify(scorecard),
      null,
      null
    ]
  );

  return result.rows[0].id;
}

// ─── Update Slack timestamps ────────────────────────────────────

async function updateSlackTs(scorecardId, { reviewTs, killerTs }) {
  const sets = [];
  const values = [];
  let idx = 1;

  if (reviewTs) {
    sets.push(`slack_review_ts = $${idx++}`);
    values.push(reviewTs);
  }
  if (killerTs) {
    sets.push(`slack_killer_ts = $${idx++}`);
    values.push(killerTs);
  }

  if (sets.length === 0) return;

  values.push(scorecardId);
  await pool.query(
    `UPDATE scorecards SET ${sets.join(", ")} WHERE id = $${idx}`,
    values
  );
}

module.exports = { saveScorecard, updateSlackTs, pool };
