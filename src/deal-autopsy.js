// ─── Won-Deal Autopsy Engine ─────────────────────────────────────
// Analyzes what differentiated the calls that led to won deals
// vs the same AE's calls on lost/stalled deals.
//
// Trigger: GET /api/deal-autopsy?dealId=X or ?rep=NAME&days=30
// Returns: Structured analysis of winning patterns

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

async function fetchDeal(dealId, apiKey) {
  try {
    const resp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${apiKey}`);
    const text = await resp.text();
    const json = JSON.parse(text);
    if (json.success && json.data) {
      return { id: json.data.id, title: json.data.title, status: json.data.status, value: json.data.value, stage_id: json.data.stage_id, pipeline_id: json.data.pipeline_id };
    }
    console.error(`[autopsy] Pipedrive error for deal ${dealId}: success=${json.success} error=${json.error}`);
  } catch (e) {
    console.error(`[autopsy] fetchDeal exception: ${e.message}`);
  }
  return null;
}

// ─── Call LLM for autopsy analysis ────────────────────────────

async function runAutopsyLLM(prompt) {
  // DeepSeek API (OpenAI-compatible)
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (deepseekKey) {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    const json = await resp.json();
    if (json.error) throw new Error(`DeepSeek error: ${json.error.message}`);
    return json.choices?.[0]?.message?.content || "";
  }

  if (openrouterKey) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    const json = await resp.json();
    if (json.error) throw new Error(`OpenRouter error: ${json.error.message}`);
    return json.choices?.[0]?.message?.content || "";
  }

  throw new Error("Set DEEPSEEK_API_KEY or OPENROUTER_API_KEY on Railway");
}

// ─── Main autopsy function ─────────────────────────────────────

async function runDealAutopsy({ dealId, repName, days, pool, pipedriveKey, firefliesKey }) {
  let debugInfo = { dealId, repName, days, keyOk: !!pipedriveKey, ffKeyLen: firefliesKey ? firefliesKey.length : 0, ffKeyPrefix: firefliesKey ? firefliesKey.substring(0, 8) + "..." : "none", deepseekKeySet: !!process.env.DEEPSEEK_API_KEY, openrouterKeySet: !!process.env.OPENROUTER_API_KEY };

  // ── Step 1: Find won deals to analyze ──────────────────────
  let targetDeals;

  if (dealId) {
    // Direct Pipedrive call with raw response capture
    let rawPipedrive = "";
    try {
      const url = `https://api.pipedrive.com/v1/deals/${dealId}?api_token=${pipedriveKey}`;
      const resp = await fetch(url);
      rawPipedrive = await resp.text();
      const json = JSON.parse(rawPipedrive);
      debugInfo.pdSuccess = json.success;
      debugInfo.pdStatus = json.data?.status;
      if (json.success && json.data) {
        targetDeals = [{
          id: json.data.id,
          title: json.data.title,
          status: json.data.status,
          value: json.data.value,
          stage_id: json.data.stage_id,
          pipeline_id: json.data.pipeline_id,
        }];
      }
    } catch (e) {
      debugInfo.pdError = e.message;
      rawPipedrive = rawPipedrive.substring(0, 200);
    }
    debugInfo.rawPipedrive = rawPipedrive.substring(0, 200);

    if (!targetDeals || targetDeals.length === 0) {
      return { error: `Deal ${dealId} not found in Pipedrive`, dealsAnalyzed: 0, _debug: debugInfo };
    }
    if (targetDeals[0].status !== "won") {
      return { error: `Deal ${dealId} is not won (status: ${targetDeals[0].status})`, dealsAnalyzed: 0, _debug: debugInfo };
    }
  } else {
    // Find won deals linked to scorecards for the given rep
    const daysAgo = days || 30;
    const repFilter = repName ? `AND s.rep_name ILIKE '${repName.replace(/'/g, "''")}%'` : "";

    // Debug: count total scorecards with pipedrive_deal_id (no rep filter)
    const { rows: totalRows } = await pool.query(`
      SELECT COUNT(*) as cnt FROM scorecards WHERE pipedrive_deal_id IS NOT NULL
    `);
    debugInfo.totalWithDealId = parseInt(totalRows[0]?.cnt || 0);

    // Debug: distinct rep names in scorecards
    const { rows: repRows } = await pool.query(`
      SELECT DISTINCT rep_name FROM scorecards WHERE pipedrive_deal_id IS NOT NULL
    `);
    debugInfo.repsWithLinkedDeals = repRows.map(r => r.rep_name);

    const { rows } = await pool.query(`
      SELECT DISTINCT s.pipedrive_deal_id, s.rep_name
      FROM scorecards s
      WHERE s.pipedrive_deal_id IS NOT NULL ${repFilter}
      LIMIT 20
    `);

    debugInfo.queryMatchCount = rows.length;
    debugInfo.sampleDealIds = rows.slice(0, 5).map(r => ({ dealId: r.pipedrive_deal_id, rep: r.rep_name }));

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

    debugInfo.pipedriveChecked = dealIds.length;
    debugInfo.wonAfterCheck = targetDeals.length;

    if (repName) {
      targetDeals = targetDeals.filter((d) =>
        rows.some((r) => r.pipedrive_deal_id === String(d.id) && r.rep_name.toLowerCase().startsWith(repName.toLowerCase()))
      );
    }
  }

  if (targetDeals.length === 0) {
    return { error: "No won deals found with linked scorecards", dealsAnalyzed: 0, _debug: debugInfo };
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
        close_style, call_date, call_type, scorecard_json
      FROM scorecards
      WHERE pipedrive_deal_id = $1
      ORDER BY call_date ASC
    `, [String(deal.id)]);

    if (wonCards.length === 0) {
      debugInfo.skippedDeals = (debugInfo.skippedDeals || []);
      debugInfo.skippedDeals.push({ dealId: deal.id, reason: "no scorecards linked" });
      continue;
    }

    // Debug: show first scorecard's meeting_id and transcript status
    const firstCard = wonCards[0];
    let hasTranscriptJson = false;
    try {
      if (firstCard.scorecard_json) {
        const sj = typeof firstCard.scorecard_json === "string" ? JSON.parse(firstCard.scorecard_json) : firstCard.scorecard_json;
        hasTranscriptJson = !!(sj.transcript || sj.full_transcript);
      }
    } catch {}
    debugInfo.firstWonCard = {
      id: firstCard.id,
      meetingId: firstCard.meeting_id,
      hasTranscriptJson,
      hasScorecardJson: !!firstCard.scorecard_json,
      repName: firstCard.rep_name,
    };

    const aeRepName = wonCards[0].rep_name;

    // Fetch transcripts for won deal calls
    const wonTranscripts = [];
    let cardsWithMeetingId = 0, cardsWithStoredTranscript = 0, cardsFetched = 0, cardsFailed = 0;
    const fetchErrors = [];
    for (const card of wonCards) {
      if (!card.meeting_id) {
        cardsFailed++;
        continue;
      }
      cardsWithMeetingId++;
      try {
        // Try stored transcript from scorecard_json first
        let storedText = null;
        try {
          if (card.scorecard_json) {
            const sj = typeof card.scorecard_json === "string" ? JSON.parse(card.scorecard_json) : card.scorecard_json;
            storedText = sj.transcript || sj.full_transcript || null;
          }
        } catch {}
        if (storedText) {
          cardsWithStoredTranscript++;
          wonTranscripts.push({
            meetingId: card.meeting_id,
            title: card.company_name || "Call",
            date: card.call_date ? new Date(card.call_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
            duration: null,
            text: storedText,
            truncated: storedText.length > 8000 ? storedText.substring(0, 8000) + "\n...[transcript truncated for analysis]" : storedText,
            score: card.score,
            rag: card.rag,
            callDate: card.call_date,
          });
        } else {
          const t = await fetchTranscript(card.meeting_id, firefliesKey);
          if (t) { cardsFetched++; wonTranscripts.push({ ...t, score: card.score, rag: card.rag, callDate: card.call_date }); }
          else { cardsFailed++; fetchErrors.push(`null for ${card.meeting_id}`); }
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (e) {
        cardsFailed++;
        fetchErrors.push(`${card.meeting_id}: ${e.message}`);
        console.error(`[autopsy] Failed to fetch transcript ${card.meeting_id}: ${e.message}`);
      }
    }
    debugInfo.transcriptStats = { cardsWithMeetingId, cardsWithStoredTranscript, cardsFetched, cardsFailed, fetchErrors };

    // ── Step 3: Get the same AE's lost/stalled deal calls for comparison ──
    const { rows: lostCards } = await pool.query(`
      SELECT s.id, s.meeting_id, s.rep_name, s.company_name, s.score, s.rag, s.verdict,
        s.score_discovery, s.score_presentation, s.score_pricing, s.score_closing,
        s.spiced_s, s.spiced_p, s.spiced_i, s.spiced_c, s.spiced_e,
        s.close_style, s.call_date, s.scorecard_json
      FROM scorecards s
      WHERE s.rep_name = $1
        AND s.pipedrive_deal_id IS NOT NULL
        AND s.pipedrive_deal_id != $2
        AND s.call_date::timestamp >= NOW() - INTERVAL '90 days'
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
      if (!dealStatus) continue;
      try {
        let storedText = null;
        try {
          if (card.scorecard_json) {
            const sj = typeof card.scorecard_json === "string" ? JSON.parse(card.scorecard_json) : card.scorecard_json;
            storedText = sj.transcript || sj.full_transcript || null;
          }
        } catch {}
        if (storedText) {
          lostTranscripts.push({
            meetingId: card.meeting_id,
            title: card.company_name || "Call",
            date: card.call_date ? new Date(card.call_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "",
            duration: null,
            text: storedText,
            truncated: storedText.length > 8000 ? storedText.substring(0, 8000) + "\n...[transcript truncated for analysis]" : storedText,
            score: card.score,
            rag: card.rag,
            dealStatus: dealStatus.status,
          });
        } else {
          const t = await fetchTranscript(card.meeting_id, firefliesKey);
          if (t) lostTranscripts.push({
            ...t,
            score: card.score,
            rag: card.rag,
            dealStatus: dealStatus.status,
          });
          await new Promise((r) => setTimeout(r, 200));
        }
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

    // Build structured data for LLM (caller handles analysis)
    autopsies.push({
      dealId: deal.id,
      dealTitle: deal.title,
      dealValue: deal.value,
      ae: aeRepName,
      callCount: wonCards.length,
      wonCallDates: wonCards.map((c) => c.call_date),
      wonAvgScore: wonCards.reduce((s, c) => s + c.score, 0) / wonCards.length,
      comparisonCalls: lostTranscripts.length,
      wonTranscripts: wonTranscripts.map(t => ({
        title: t.title,
        date: t.date,
        text: t.truncated || t.text,
        score: t.score,
        rag: t.rag,
      })),
      lostTranscripts: lostTranscripts.map(t => ({
        title: t.title,
        date: t.date,
        text: t.truncated || t.text,
        score: t.score,
        rag: t.rag,
        dealStatus: t.dealStatus,
      })),
      wonScorecards: wonCards.map(c => ({
        id: c.id,
        score: c.score,
        rag: c.rag,
        spiced_p: c.spiced_p,
        spiced_i: c.spiced_i,
        spiced_c: c.spiced_c,
        spiced_e: c.spiced_e,
        close_style: c.close_style,
        call_date: c.call_date,
      })),
      analysisPrompt: `You are a sales coach analyzing what differentiated a WON deal from the same AE's other deals.

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

Focus on SPECIFIC behaviors, exact phrases, and observable differences — not generic sales advice. Use timestamps. If the comparison data is thin, note that limitation.`,
      status: "data_ready",
      generatedAt: new Date().toISOString(),
    });

    // Try LLM analysis if key is available
    try {
      console.log(`[autopsy] Running LLM analysis for deal #${deal.id}...`);
      const llmOutput = await runAutopsyLLM(autopsies[autopsies.length - 1].analysisPrompt);
      console.log(`[autopsy] LLM output: ${llmOutput.substring(0, 200)}...`);

      let parsed;
      try {
        parsed = JSON.parse(llmOutput);
      } catch {
        const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: llmOutput };
      }

      autopsies[autopsies.length - 1].analysis = parsed;
      autopsies[autopsies.length - 1].status = "analyzed";
    } catch (e) {
      console.error(`[autopsy] LLM failed for deal #${deal.id}: ${e.message}`);
      autopsies[autopsies.length - 1].llmError = e.message;
      // Keep status as "data_ready" — caller can retry analysis
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dealsAnalyzed: autopsies.length,
    autopsies,
    _debug: debugInfo,
  };
}

module.exports = { runDealAutopsy };
