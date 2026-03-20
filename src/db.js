const { Pool } = require("pg");

// ─── Database Client ────────────────────────────────────────────
// Persists scorecards to Neon Postgres.

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Find or create a rep ───────────────────────────────────────

async function findOrCreateRep(repName, teamId) {
  // Try to find existing rep by name and team
  const existing = await pool.query(
    "SELECT id FROM reps WHERE name = $1 AND team_id = $2 LIMIT 1",
    [repName, teamId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new rep
  const result = await pool.query(
    "INSERT INTO reps (name, team_id) VALUES ($1, $2) RETURNING id",
    [repName, teamId]
  );

  return result.rows[0].id;
}

// ─── Save a scorecard ───────────────────────────────────────────

async function saveScorecard(scorecard, meta) {
  const teamId = meta.teamId;
  const repId = await findOrCreateRep(meta.repName, teamId);

  const result = await pool.query(
    `INSERT INTO scorecards (
      rep_id, meeting_id, title, company_name, rep_name,
      call_date, duration_minutes,
      score, rag, verdict,
      score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
      spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
      bant_b, bant_a, bant_n, bant_t,
      close_style, close_setup, close_bridge, close_ask,
      call_type, prospect_email,
      scorecard_json, slack_review_ts, slack_killer_ts,
      team_id
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7,
      $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21, $22, $23, $24,
      $25, $26, $27, $28,
      $29, $30,
      $31, $32, $33,
      $34
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      score = EXCLUDED.score,
      rag = EXCLUDED.rag,
      verdict = EXCLUDED.verdict,
      score_pre_call = EXCLUDED.score_pre_call,
      score_discovery = EXCLUDED.score_discovery,
      score_presentation = EXCLUDED.score_presentation,
      score_pricing = EXCLUDED.score_pricing,
      score_closing = EXCLUDED.score_closing,
      spiced_s = EXCLUDED.spiced_s,
      spiced_p = EXCLUDED.spiced_p,
      spiced_i = EXCLUDED.spiced_i,
      spiced_c = EXCLUDED.spiced_c,
      spiced_e = EXCLUDED.spiced_e,
      bant_b = EXCLUDED.bant_b,
      bant_a = EXCLUDED.bant_a,
      bant_n = EXCLUDED.bant_n,
      bant_t = EXCLUDED.bant_t,
      close_style = EXCLUDED.close_style,
      close_setup = EXCLUDED.close_setup,
      close_bridge = EXCLUDED.close_bridge,
      close_ask = EXCLUDED.close_ask,
      call_type = EXCLUDED.call_type,
      prospect_email = EXCLUDED.prospect_email,
      scorecard_json = EXCLUDED.scorecard_json,
      team_id = EXCLUDED.team_id
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
      scorecard.close?.style || null,
      scorecard.close?.setup?.status || null,
      scorecard.close?.bridge?.status || null,
      scorecard.close?.ask?.status || null,
      meta.callType || "discovery",
      meta.prospectEmail || null,
      JSON.stringify(scorecard),
      null,
      null,
      teamId
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

// ─── Playbook extraction ─────────────────────────────────────

async function extractPlaybookExamples(scorecard, meta, scorecardId, teamId) {
  const examples = [];

  // 1. Objection Handling — 3+ ECIR steps
  const objections = scorecard.phases?.pricing?.criteria?.ecir?.objections || [];
  const ecirFeedback = scorecard.phases?.pricing?.criteria?.ecir?.feedback || "";
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
        metadata: JSON.stringify(obj),
      });
    }
  }

  // 2. Close Execution — strong ask
  if (scorecard.close?.ask?.status === "strong" && scorecard.close?.style !== "none") {
    const parts = [];
    if (scorecard.close.setup?.feedback) parts.push(`**${scorecard.close.setup.label || "Setup"}**: ${scorecard.close.setup.feedback}`);
    if (scorecard.close.bridge?.feedback) parts.push(`**${scorecard.close.bridge.label || "Bridge"}**: ${scorecard.close.bridge.feedback}`);
    if (scorecard.close.ask?.feedback) parts.push(`**${scorecard.close.ask.label || "Ask"}**: ${scorecard.close.ask.feedback}`);
    examples.push({
      category: "close_execution",
      title: `${scorecard.close.styleName || scorecard.close.style} Close`,
      body: parts.join("\n\n"),
      timestamp: scorecard.close.ask?.timestamps?.[0] || null,
      metadata: JSON.stringify(scorecard.close),
    });
  }

  // 3. Discovery Wins — green calls only
  if (scorecard.rag === "green" && Array.isArray(scorecard.wins)) {
    for (const win of scorecard.wins) {
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

  // 4. Quotes — green calls only
  if (scorecard.rag === "green" && scorecard.quoteOfTheCall?.text) {
    const q = scorecard.quoteOfTheCall;
    examples.push({
      category: "quote",
      title: q.text.length > 80 ? q.text.substring(0, 77) + "..." : q.text,
      body: `"${q.text}"\n\n${q.context || ""}`,
      timestamp: q.timestamp || null,
      metadata: JSON.stringify(q),
    });
  }

  if (examples.length === 0) return;

  // Clear previous auto-extracted examples for this scorecard
  await pool.query(`DELETE FROM playbook_examples WHERE scorecard_id = $1 AND source = 'auto'`, [scorecardId]);

  // Insert new examples
  for (const ex of examples) {
    await pool.query(
      `INSERT INTO playbook_examples (team_id, scorecard_id, category, title, body, rep_name, company_name, call_date, timestamp, metadata, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'auto')`,
      [teamId, scorecardId, ex.category, ex.title, ex.body, meta.repName, meta.companyName, meta.date, ex.timestamp, ex.metadata]
    );
  }

  console.log(`[playbook] Extracted ${examples.length} examples from ${meta.repName} → ${meta.companyName}`);
}

module.exports = { saveScorecard, updateSlackTs, extractPlaybookExamples, pool };
