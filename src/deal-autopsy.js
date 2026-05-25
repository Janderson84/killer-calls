// ─── Won-Deal Autopsy Engine ─────────────────────────────────────
// Analyzes what differentiated the calls that led to won deals
// vs the same AE's calls on lost/stalled deals.
//
// Trigger: GET /api/deal-autopsy?dealId=X or ?rep=NAME&days=30
// Returns: Structured analysis of winning patterns

const { execSync } = require("child_process");

const FIREFLIES_QUERY = `
  query Transcript($transcriptId: String!) {
    transcript(id: $transcriptId) {
      id title date duration
      speakers { id name }
      sentences {
        index text raw_text start_time end_time speaker_id speaker_name
      }
      organizer_email participants
    }
  }
`;

// ─── Fetch transcript from Fireflies ──────────────────────────

async function fetchTranscript(meetingId, apiKey) {
  const resp = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query: FIREFLIES_QUERY, variables: { transcriptId: meetingId } }),
  });
  const json = await resp.json();
  if (json.errors) throw new Error(`Fireflies error: ${JSON.stringify(json.errors)}`);
  const t = json.data?.transcript;
  if (!t) return null;

  const text = (t.sentences || []).map((s) => {
    const mins = Math.floor((s.start_time || 0) / 60);
    const secs = Math.floor((s.start_time || 0) % 60);
    return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}] ${s.speaker_name || "?"}: ${s.text || s.raw_text || ""}`;
  }).join("\n");

  return {
    meetingId: t.id,
    title: t.title || "",
    date: t.date ? new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
    duration: t.duration ? Math.round(t.duration) : null,
    text,
    truncated: text.length > 8000 ? text.substring(0, 8000) + "\n...[transcript truncated for analysis]" : text,
  };
}

// ─── Fetch deal info from Pipedrive ───────────────────────────

async function fetchDeal(dealId, pipedriveKey) {
  const resp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${pipedriveKey}`);
  const json = await resp.json();
  if (!json.success || !json.data) return null;
  return {
    id: json.data.id,
    title: json.data.title,
    status: json.data.status,
    value: json.data.value,
    stage_id: json.data.stage_id,
    pipeline_id: json.data.pipeline_id,
    won_time: json.data.won_time,
    add_time: json.data.add_time,
  };
}

// ─── Call LLM for autopsy analysis ────────────────────────────

async function runAutopsyLLM(prompt) {
  // Try Gemini first (if key is set)
  if (process.env.GEMINI_API_KEY) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        }
      );
      const json = await resp.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (e) {
      console.error("[autopsy] Gemini failed, falling back to OpenClaw:", e.message);
    }
  }

  // Fall back to OpenClaw CLI
  try {
    const result = execSync("openclaw agent --raw", {
      input: prompt,
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024,
      timeout: 120000,
    });
    return result.trim();
  } catch (e) {
    throw new Error(`OpenClaw autopsy failed: ${e.message}`);
  }
}

// ─── Main autopsy function ─────────────────────────────────────

async function runDealAutopsy({ dealId, repName, days, pool, pipedriveKey, firefliesKey }) {
  // ── Step 1: Find won deals to analyze ──────────────────────
  let targetDeals;

  if (dealId) {
    // Specific deal
    const deal = await fetchDeal(dealId, pipedriveKey);
    if (!deal) throw new Error(`Deal ${dealId} not found in Pipedrive`);
    if (deal.status !== "won") throw new Error(`Deal ${dealId} is not won (status: ${deal.status})`);
    targetDeals = [deal];
  } else {
    // Find won deals linked to scorecards for the given rep
    const daysAgo = days || 30;
    const repFilter = repName ? `AND s.rep_name = '${repName.replace(/'/g, "''")}'` : "";
    const { rows } = await pool.query(`
      SELECT DISTINCT s.pipedrive_deal_id, s.rep_name
      FROM scorecards s
      WHERE s.pipedrive_deal_id IS NOT NULL ${repFilter}
        AND s.call_date >= NOW() - INTERVAL '${daysAgo} days'
      ORDER BY s.call_date DESC
      LIMIT 20
    `);

    // Fetch live status from Pipedrive in batches
    const dealIds = [...new Set(rows.map((r) => r.pipedrive_deal_id))];
    targetDeals = [];
    for (let i = 0; i < dealIds.length; i += 5) {
      const batch = dealIds.slice(i, i + 5);
      const results = await Promise.all(batch.map((id) => fetchDeal(id, pipedriveKey)));
      for (const d of results) {
        if (d && d.status === "won") targetDeals.push(d);
      }
      if (i + 5 < dealIds.length) await new Promise((r) => setTimeout(r, 300));
    }

    if (repName) {
      targetDeals = targetDeals.filter((d) =>
        rows.some((r) => r.pipedrive_deal_id === String(d.id) && r.rep_name === repName)
      );
    }
  }

  if (targetDeals.length === 0) {
    return { error: "No won deals found with linked scorecards", dealsAnalyzed: 0 };
  }
  console.log(`[autopsy] Found ${targetDeals.length} won deal(s) to analyze`);

  // ── Step 2: For each won deal, get its scorecard call transcripts ──
  const autopsies = [];

  for (const deal of targetDeals) {
    console.log(`[autopsy] Analyzing deal #${deal.id}: ${deal.title}`);

    // Get all scorecards linked to this deal
    const { rows: wonCards } = await pool.query(`
      SELECT id, meeting_id, rep_name, company_name, score, rag, verdict,
        score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        bant_b, bant_a, bant_n, bant_t,
        close_style, call_date, call_type
      FROM scorecards
      WHERE pipedrive_deal_id = $1
      ORDER BY call_date ASC
    `, [String(deal.id)]);

    if (wonCards.length === 0) continue;

    const aeRepName = wonCards[0].rep_name;

    // Fetch transcripts for won deal calls
    const wonTranscripts = [];
    for (const card of wonCards) {
      if (!card.meeting_id) continue;
      try {
        const t = await fetchTranscript(card.meeting_id, firefliesKey);
        if (t) wonTranscripts.push({ ...t, score: card.score, rag: card.rag, callDate: card.call_date });
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        console.error(`[autopsy] Failed to fetch transcript ${card.meeting_id}: ${e.message}`);
      }
    }

    // ── Step 3: Get the same AE's lost/stalled deal calls for comparison ──
    const { rows: lostCards } = await pool.query(`
      SELECT s.id, s.meeting_id, s.rep_name, s.company_name, s.score, s.rag, s.verdict,
        s.score_discovery, s.score_presentation, s.score_pricing, s.score_closing,
        s.spiced_s, s.spiced_p, s.spiced_i, s.spiced_c, s.spiced_e,
        s.close_style, s.call_date
      FROM scorecards s
      WHERE s.rep_name = $1
        AND s.pipedrive_deal_id IS NOT NULL
        AND s.pipedrive_deal_id != $2
        AND s.call_date >= NOW() - INTERVAL '90 days'
      ORDER BY s.call_date DESC
      LIMIT 5
    `, [aeRepName, String(deal.id)]);

    // Fetch Pipedrive status for comparison deals, keep only lost/stalled
    const lostDealIds = [...new Set(lostCards.map((r) => r.pipedrive_deal_id))];
    const lostDealStatuses = {};
    for (const lid of lostDealIds) {
      const d = await fetchDeal(lid, pipedriveKey);
      if (d && (d.status === "lost" || d.status === "open")) {
        lostDealStatuses[lid] = d;
      }
    }

    const lostTranscripts = [];
    for (const card of lostCards) {
      if (!card.meeting_id) continue;
      const dealStatus = lostDealStatuses[card.pipedrive_deal_id];
      if (!dealStatus) continue; // Skip won deals in comparison set
      try {
        const t = await fetchTranscript(card.meeting_id, firefliesKey);
        if (t) lostTranscripts.push({
          ...t,
          score: card.score,
          rag: card.rag,
          dealStatus: dealStatus.status,
        });
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        // skip
      }
    }

    if (wonTranscripts.length === 0) {
      autopsies.push({
        dealId: deal.id,
        dealTitle: deal.title,
        dealValue: deal.value,
        status: "skipped",
        reason: "No transcripts available for won deal calls",
      });
      continue;
    }

    // ── Step 4: Build the autopsy prompt ──────────────────────
    const wonSummary = wonTranscripts.map((t, i) => {
      const card = wonCards[i] || {};
      return [
        `=== WON DEAL CALL #${i + 1}: ${t.title} (${t.date}, ${t.duration}min) ===`,
        `Score: ${t.score}/100 (${t.rag})`,
        `SPICED: P=${card.spiced_p || "?"} I=${card.spiced_i || "?"} C=${card.spiced_c || "?"} E=${card.spiced_e || "?"}`,
        `Close style: ${card.close_style || "none"}`,
        ``,
        t.truncated || t.text,
      ].join("\n");
    }).join("\n\n");

    const lostSummary = lostTranscripts.length > 0
      ? lostTranscripts.map((t, i) => [
          `=== LOST/STALLED CALL #${i + 1}: ${t.title} (${t.date}) ===`,
          `Score: ${t.score}/100 (${t.rag})`,
          `Deal status: ${t.dealStatus}`,
          ``,
          t.truncated || t.text,
        ].join("\n")).join("\n\n")
      : "(No lost/stalled deal transcripts available for comparison)";

    const prompt = `You are a sales coach analyzing what differentiated a WON deal from the same AE's other deals.

CONTEXT:
- AE: ${aeRepName}
- Won deal: "${deal.title}" ($${deal.value || "N/A"})
- This deal had ${wonCards.length} call(s)

WON DEAL CALL TRANSCRIPTS:
${wonSummary}

COMPARISON: ${aeRepName}'s calls on LOST/STALLED deals (for contrast):
${lostSummary}

ANALYZE and return a JSON object with these fields:
{
  "summary": "2-3 sentence executive summary of what made this deal close",
  "key_differentiators": [
    { "dimension": "Discovery/SPICED/Pricing/Closing/etc", "what_worked": "specific behavior observed", "evidence": "quote or timestamp from transcript" }
  ],
  "patterns_to_replicate": ["1-3 specific things the AE should repeat"],
  "followup_signals": "What happened BETWEEN calls that indicated progression?",
  "coaching_insight": "1 sentence actionable coaching tip for this AE",
  "winning_close_style": "How the AE closed this deal vs their typical approach"
}

Focus on SPECIFIC behaviors, exact phrases, and observable differences — not generic sales advice. Use timestamps. If the comparison data is thin, note that limitation.`;

    try {
      console.log(`[autopsy] Running LLM analysis for deal #${deal.id}...`);
      const llmOutput = await runAutopsyLLM(prompt);
      console.log(`[autopsy] LLM output: ${llmOutput.substring(0, 200)}...`);

      // Parse JSON from output (may be wrapped in markdown)
      let parsed;
      try {
        parsed = JSON.parse(llmOutput);
      } catch {
        const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: llmOutput };
      }

      autopsies.push({
        dealId: deal.id,
        dealTitle: deal.title,
        dealValue: deal.value,
        ae: aeRepName,
        callCount: wonCards.length,
        wonCallDates: wonCards.map((c) => c.call_date),
        wonAvgScore: wonCards.reduce((s, c) => s + c.score, 0) / wonCards.length,
        comparisonCalls: lostTranscripts.length,
        analysis: parsed,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[autopsy] LLM failed for deal #${deal.id}: ${e.message}`);
      autopsies.push({
        dealId: deal.id,
        dealTitle: deal.title,
        status: "error",
        error: e.message,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dealsAnalyzed: autopsies.length,
    autopsies,
  };
}

module.exports = { runDealAutopsy };
