require("dotenv").config();

const express = require("express");
const { fetchTranscript } = require("./fireflies-client");
const { scoreTranscript, FOLLOWUP_SYSTEM_PROMPT, buildFollowupScoringPrompt, buildScoringPromptWithWeights } = require("./scoring-engine");
const { postDemoReview, postKillerCall, calculateStallRisk, stallRiskBlock } = require("./slack-formatter");
const { runDealAutopsy, saveAutopsy } = require("./deal-autopsy");
const { saveScorecard, updateSlackTs, extractPlaybookExamples, pool } = require("./db");
const { CONFIG } = require("./constants");

// ─── Followup detection ──────────────────────────────────────────

const FOLLOWUP_TITLE_PATTERNS = /follow[\s-]?up|2nd\s*call|second\s*call|check[\s-]?in/i;

function extractProspectEmail(participants, aeEmails) {
  if (!participants || !Array.isArray(participants)) return null;
  for (const p of participants) {
    const email = (typeof p === "string" ? p : p?.email || "").toLowerCase().trim();
    if (email && email.includes("@") && !aeEmails.has(email)) {
      return email;
    }
  }
  return null;
}

async function detectFollowup(repName, companyName, prospectEmail, title) {
  // 1. Check by prospect email (most reliable)
  if (prospectEmail) {
    const priorByEmail = await pool.query(
      `SELECT id, score, rag, verdict, company_name,
              spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
              bant_b, bant_a, bant_n, bant_t,
              scorecard_json
       FROM scorecards
       WHERE prospect_email = $1 AND rep_name = $2
       ORDER BY created_at DESC LIMIT 1`,
      [prospectEmail, repName]
    );
    if (priorByEmail.rows.length > 0) {
      return { isFollowup: true, priorCallContext: buildPriorContext(priorByEmail.rows[0]) };
    }
  }

  // 2. Check by company name
  const priorByCompany = await pool.query(
    `SELECT id, score, rag, verdict, company_name,
            spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
            bant_b, bant_a, bant_n, bant_t,
            scorecard_json
     FROM scorecards
     WHERE company_name = $1 AND rep_name = $2
     ORDER BY created_at DESC LIMIT 1`,
    [companyName, repName]
  );
  if (priorByCompany.rows.length > 0) {
    return { isFollowup: true, priorCallContext: buildPriorContext(priorByCompany.rows[0]) };
  }

  // 3. Check by title pattern
  if (FOLLOWUP_TITLE_PATTERNS.test(title || "")) {
    return { isFollowup: true, priorCallContext: null };
  }

  return { isFollowup: false, priorCallContext: null };
}

function buildPriorContext(row) {
  let sc = null;
  try {
    sc = typeof row.scorecard_json === "string" ? JSON.parse(row.scorecard_json) : row.scorecard_json;
  } catch {}
  const lines = [];
  lines.push(`Prior call score: ${row.score}/100 (${row.rag})`);
  lines.push(`Verdict: ${row.verdict}`);

  const spicedItems = ["s", "p", "i", "c", "e"].map((k) => {
    const status = row[`spiced_${k}`] || "missing";
    const word = k === "s" ? "Situation" : k === "p" ? "Pain" : k === "i" ? "Impact" : k === "c" ? "Critical Event" : "Decision";
    return `${word}: ${status}`;
  });
  lines.push(`SPICED: ${spicedItems.join(", ")}`);

  const bantItems = ["b", "a", "n", "t"].map((k) => {
    const status = row[`bant_${k}`] || "missing";
    const word = k === "b" ? "Budget" : k === "a" ? "Authority" : k === "n" ? "Need" : "Timeline";
    return `${word}: ${status}`;
  });
  lines.push(`BANT: ${bantItems.join(", ")}`);

  if (sc?.fixes?.length > 0) {
    lines.push(`Top fixes from prior call:\n${sc.fixes.map((f) => `  - ${f}`).join("\n")}`);
  }

  return lines.join("\n");
}

// ─── Team routing ────────────────────────────────────────────────
// Look up which team a call belongs to based on organizer email

async function resolveTeam(organizerEmail) {
  // Query all team rosters from settings
  const result = await pool.query(
    `SELECT s.team_id, s.value as roster
     FROM settings s
     WHERE s.key = 'ae_roster'`
  );

  for (const row of result.rows) {
    const roster = typeof row.roster === "string" ? JSON.parse(row.roster) : row.roster;
    if (!Array.isArray(roster)) continue;
    for (const ae of roster) {
      if (ae.email && ae.email.toLowerCase() === organizerEmail.toLowerCase()) {
        if (ae.active === false) {
          console.log(`[team] AE ${ae.name} is inactive — skipping scoring`);
          return null;
        }
        return { teamId: row.team_id, aeEntry: ae };
      }
    }
  }

  return null;
}

// Build a Set of AE emails for a team roster
function buildAeEmailSet(roster) {
  const set = new Set();
  if (Array.isArray(roster)) {
    for (const ae of roster) {
      if (ae.email) set.add(ae.email.toLowerCase());
    }
  }
  return set;
}

// Get team-specific settings
async function getTeamSettings(teamId) {
  const result = await pool.query(
    `SELECT key, value FROM settings WHERE team_id = $1`,
    [teamId]
  );
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  }
  return settings;
}

// ─── Dedup guard ─────────────────────────────────────────────
// Prevent double-processing when Fireflies sends duplicate webhooks
const inFlightMeetings = new Set();

const app = express();
app.use(express.json());

// ─── Health check ────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "killer-calls-mvp", version: "2.0.0" });
});

// ─── Fireflies Webhook ──────────────────────────────────────────
// Receives a POST when a new transcript is ready.
// Immediately returns 200, then processes async.


// ─── Score Endpoint ──────────────────────────────────────────────
// Called by Vercel routes (or any client) to score a transcript.
// This delegates to the configured scoring backend (OpenClaw or Anthropic).

app.post("/score", async (req, res) => {
  const { meetingId, transcriptText, repName, companyName, durationMinutes, systemPrompt, userPrompt, callType, priorCallContext } = req.body;

  if (!meetingId || !transcriptText || !repName) {
    return res.status(400).json({ error: "meetingId, transcriptText, and repName are required" });
  }

  console.log(`[/score] Scoring meetingId=${meetingId} (${repName} -> ${companyName})`);

  try {
    const { scoreTranscript, buildFollowupScoringPrompt, buildScoringPromptWithWeights, FOLLOWUP_SYSTEM_PROMPT } = require("./scoring-engine");

    const scoringArgs = {
      transcriptText,
      repName,
      companyName,
      durationMinutes,
      meetingId,
      pool,
    };

    if (callType === "followup" && priorCallContext) {
      scoringArgs.systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
      scoringArgs.userPrompt = buildFollowupScoringPrompt(transcriptText, repName, companyName, durationMinutes, priorCallContext);
    }

    const scorecard = await scoreTranscript(scoringArgs);

    if (scorecard._deferred) {
      return res.json({ status: "deferred", message: "Scoring deferred - will be processed by local poller" });
    }

    return res.json({ status: "ok", scorecard });
  } catch (err) {
    console.error(`[/score] Error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/webhook/fireflies", (req, res) => {
  const meetingId = req.body.meetingId || req.body.meeting_id || req.body.data?.meetingId;

  if (!meetingId) {
    console.warn("[webhook] Received webhook with no meetingId:", JSON.stringify(req.body).substring(0, 200));
    return res.status(400).json({ error: "meetingId is required" });
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`[webhook] Received: meetingId=${meetingId}`);
  console.log(`[webhook] Time: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);

  // Acknowledge immediately — don't block Fireflies
  res.status(200).json({ received: true, meetingId });

  // Process async
  processDemo(meetingId).catch((err) => {
    console.error(`[pipeline] FAILED for meetingId=${meetingId}:`, err.message);
  });
});

// ─── Pipeline ────────────────────────────────────────────────────
// The full flow: fetch → route team → score → post.

async function processDemo(meetingId) {
  // Dedup: skip if already processing or already scored
  if (inFlightMeetings.has(meetingId)) {
    console.log(`[dedup] Already processing meetingId=${meetingId} — skipping duplicate webhook`);
    return;
  }
  inFlightMeetings.add(meetingId);

  try {
    // Check if already scored in DB (survives restarts)
    const existing = await pool.query(
      `SELECT id FROM scorecards WHERE meeting_id = $1`,
      [meetingId]
    );
    if (existing.rows.length > 0) {
      console.log(`[dedup] meetingId=${meetingId} already scored (${existing.rows[0].id}) — skipping`);
      return;
    }

    await _processDemo(meetingId);
  } finally {
    inFlightMeetings.delete(meetingId);
  }
}

async function _processDemo(meetingId) {
  const startTime = Date.now();

  // Claim this meeting so no other pipeline processes it concurrently
  const claim = await pool.query(
    `INSERT INTO skipped_meetings (meeting_id, reason) VALUES ($1, 'processing')
     ON CONFLICT DO NOTHING RETURNING meeting_id`,
    [meetingId]
  );
  if (claim.rows.length === 0) {
    console.log(`[dedup] meetingId=${meetingId} already claimed by another pipeline — skipping`);
    return;
  }

  // Step 1: Fetch transcript from Fireflies
  console.log(`\n[1/5] Fetching transcript from Fireflies...`);
  const transcript = await fetchTranscript(meetingId);
  console.log(`[1/5] Got transcript: "${transcript.title}" (${transcript.durationMinutes} min, ${transcript.transcriptText.length} chars)`);

  // Step 2: Resolve team from organizer email
  console.log(`\n[2/5] Resolving team...`);
  const organizerEmail = transcript.participants?.find((p) => {
    const email = (typeof p === "string" ? p : p?.email || "").toLowerCase();
    return email.includes("@");
  }) || "";
  const orgEmail = (typeof organizerEmail === "string" ? organizerEmail : organizerEmail?.email || "").toLowerCase();

  const teamMatch = await resolveTeam(orgEmail);
  if (!teamMatch) {
    console.warn(`[2/5] No team found for organizer email: ${orgEmail} — skipping`);
    return;
  }

  const { teamId, aeEntry } = teamMatch;
  const teamSettings = await getTeamSettings(teamId);
  const aeEmails = buildAeEmailSet(teamSettings.ae_roster || []);

  console.log(`[2/5] Team: ${teamId}, AE: ${aeEntry.name}`);

  // Extract prospect email
  const prospectEmail = extractProspectEmail(transcript.participants, aeEmails);
  if (prospectEmail) {
    console.log(`[2/5] Prospect email: ${prospectEmail}`);
  }

  // Check excluded patterns
  const excludedPatterns = teamSettings.excluded_patterns || [];
  if (Array.isArray(excludedPatterns) && excludedPatterns.length > 0) {
    for (const pattern of excludedPatterns) {
      try {
        if (new RegExp(pattern, "i").test(transcript.title || "")) {
          console.log(`[2/5] Skipping — title "${transcript.title}" matches excluded pattern "${pattern}"`);
          return;
        }
      } catch {}
    }
  }

  // Detect followup
  const { isFollowup, priorCallContext } = await detectFollowup(
    transcript.repName, transcript.companyName, prospectEmail, transcript.title
  );
  const callType = isFollowup ? "followup" : "discovery";
  if (isFollowup) {
    console.log(`[2/5] Detected as FOLLOW-UP call${priorCallContext ? " (prior call found)" : " (title match)"}`);
  }

  // Step 3: Score with Claude
  console.log(`\n[3/5] Scoring with Claude (${callType})...`);
  const scoringArgs = {
    transcriptText: transcript.transcriptText,
    repName: transcript.repName,
    companyName: transcript.companyName,
    durationMinutes: transcript.durationMinutes
  };

  if (isFollowup) {
    scoringArgs.systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
    scoringArgs.userPrompt = buildFollowupScoringPrompt(
      transcript.transcriptText, transcript.repName, transcript.companyName,
      transcript.durationMinutes, priorCallContext
    );
  } else if (teamSettings.scoring_weights) {
    scoringArgs.userPrompt = buildScoringPromptWithWeights(
      transcript.transcriptText, transcript.repName, transcript.companyName,
      transcript.durationMinutes, teamSettings.scoring_weights
    );
  }

  scoringArgs.meetingId = meetingId;
  scoringArgs.pool = pool;
  const scorecard = await scoreTranscript(scoringArgs);

  // If scoring was deferred, exit early
  if (scorecard._deferred) {
    console.log("[3/5] Score: DEFERRED - will be processed by local poller");
    await pool.query("DELETE FROM skipped_meetings WHERE meeting_id = $1", [meetingId]);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("Pipeline complete in " + elapsed + "s - scoring deferred");
    return;
  }
  console.log(`[3/5] Score: ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`[3/5] Verdict: ${scorecard.verdict}`);

  const meta = {
    repName: transcript.repName,
    companyName: transcript.companyName,
    date: transcript.date,
    durationMinutes: transcript.durationMinutes,
    meetingId,
    callType,
    prospectEmail,
    teamId
  };

  // Step 4: Save to database (and release the processing claim)
  console.log(`\n[4/5] Saving to database...`);
  const scorecardId = await saveScorecard(scorecard, meta);
  await pool.query(`DELETE FROM skipped_meetings WHERE meeting_id = $1`, [meetingId]);
  console.log(`[4/5] Saved scorecard: ${scorecardId}`);

  // Extract playbook examples
  try {
    await extractPlaybookExamples(scorecard, meta, scorecardId, teamId);
  } catch (err) {
    console.error(`[playbook] Extraction failed: ${err.message}`);
  }

  // Step 4b: Look up matching Pipedrive deal
  console.log(`[4b/5] Looking up Pipedrive deal...`);
  const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY;
  let pipedriveDealId = null;
  let pipedriveDealTitle = null;
  let pipedriveDealValue = null;
  let pipedriveDealStage = null;
  if (PIPEDRIVE_API_KEY && meta.prospectEmail) {
    try {
      const pdPersonResp = await fetch(
        `https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(meta.prospectEmail)}&limit=3&api_token=${PIPEDRIVE_API_KEY}`
      );
      const pdPersonData = await pdPersonResp.json();
      if (pdPersonData.success && pdPersonData.data?.items?.[0]?.item) {
        const personId = pdPersonData.data.items[0].item.id;
        const pdDealsResp = await fetch(
          `https://api.pipedrive.com/v1/persons/${personId}/deals?api_token=${PIPEDRIVE_API_KEY}`
        );
        const pdDealsData = await pdDealsResp.json();
        if (pdDealsData.success && pdDealsData.data?.length > 0) {
          const deals = pdDealsData.data.sort((a, b) => {
            if (a.status === 'open' && b.status !== 'open') return -1;
            if (a.status !== 'open' && b.status === 'open') return 1;
            return 0;
          });
          const deal = deals[0];
          let stageName = String(deal.stage_id);
          try {
            const stageResp = await fetch(
              `https://api.pipedrive.com/v1/stages/${deal.stage_id}?api_token=${PIPEDRIVE_API_KEY}`
            );
            const stageData = await stageResp.json();
            if (stageData.success && stageData.data) stageName = stageData.data.name;
          } catch (e) {}
          console.log(`[4b/5] Found Pipedrive deal #${deal.id} (${deal.title}) [${stageName}]`);
          pipedriveDealId = String(deal.id);
          pipedriveDealTitle = deal.title || null;
          pipedriveDealValue = deal.value || null;
          pipedriveDealStage = stageName;
          await pool.query(
            `UPDATE scorecards SET pipedrive_deal_id = $1, pipedrive_deal_stage = $2, pipedrive_deal_value = $3 WHERE id = $4`,
            [pipedriveDealId, pipedriveDealStage, pipedriveDealValue, scorecardId]
          );
        } else {
          console.log(`[4b/5] No Pipedrive deals for person #${personId}`);
        }
      } else {
        console.log(`[4b/5] No matching Pipedrive person for ${meta.prospectEmail}`);
      }
    } catch (err) {
      console.error(`[4b/5] Pipedrive lookup error: ${err.message}`);
    }
  } else if (!PIPEDRIVE_API_KEY) {
    console.log(`[4b/5] PIPEDRIVE_API_KEY not set, skipping deal lookup`);
  } else {
    console.log(`[4b/5] No prospect email, skipping Pipedrive lookup`);
  }

  // Attach Pipedrive deal info to meta so Slack formatter can use it
  meta.pipedriveDealId = pipedriveDealId;
  meta.pipedriveDealTitle = pipedriveDealTitle;
  meta.pipedriveDealValue = pipedriveDealValue;
  meta.pipedriveDealStage = pipedriveDealStage;

  // Fetch recent average for trend comparison in Slack thread
  console.log(`[4c/5] Fetching recent scores for ${meta.repName}...`);
  try {
    const recentQuery = await pool.query(
      `SELECT score FROM scorecards
       WHERE rep_name = $1 AND id != $2
       ORDER BY created_at DESC LIMIT 5`,
      [meta.repName, scorecardId]
    );
    if (recentQuery.rows.length > 0) {
      const scores = recentQuery.rows.map(r => r.score);
      meta.recentAvg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      meta.recentCount = scores.length;
      console.log(`[4c/5] Recent avg: ${meta.recentAvg}/100 over ${meta.recentCount} calls`);
    } else {
      console.log(`[4c/5] No prior scores found for ${meta.repName}`);
    }
  } catch (err) {
    console.error(`[4c/5] Error fetching recent scores: ${err.message}`);
  }

  // Step 5: Post to Slack (using team-specific channel IDs)
  console.log(`\n[5/5] Posting to Slack...`);

  const slackReviewsChannel = teamSettings.slack_channel_reviews || process.env.SLACK_CHANNEL_REVIEWS;
  const slackKillerChannel = teamSettings.slack_channel_killer || process.env.SLACK_CHANNEL_KILLER;
  const appUrl = teamSettings.app_url || process.env.APP_URL;
  const roster = teamSettings.ae_roster || [];
  const slackBotToken = teamSettings.slack_bot_token || undefined;
  const killerThreshold = teamSettings.killer_threshold || 80;

  // Always post to #demo-reviews
  const reviewResult = await postDemoReview(scorecard, meta, scorecardId, {
    channelId: slackReviewsChannel,
    appUrl,
    roster,
    slackBotToken,
  });

  // Post to #killer-calls if score >= threshold
  let killerResult = null;
  if (scorecard.score >= killerThreshold) {
    killerResult = await postKillerCall(scorecard, meta, scorecardId, {
      channelId: slackKillerChannel,
      appUrl,
      roster,
      slackBotToken,
      killerThreshold,
    });
  }

  // Update scorecard with Slack message timestamps
  await updateSlackTs(scorecardId, {
    reviewTs: reviewResult?.ts || null,
    killerTs: killerResult?.ts || null
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Pipeline complete in ${elapsed}s — ${scorecard.score}/100 (${scorecard.rag})`);
  console.log(`${"—".repeat(60)}\n`);

  // Async: run won-deal autopsy for this AE after every demo
  const aeName = transcript.repName;
  if (aeName && process.env.PIPEDRIVE_API_KEY && process.env.FIREFLIES_API_KEY) {
    console.log(`[autopsy] Starting background analysis for ${aeName}...`);
    runDealAutopsy({
      repName: aeName,
      days: 90,
      pool,
      pipedriveKey: process.env.PIPEDRIVE_API_KEY,
      firefliesKey: process.env.FIREFLIES_API_KEY,
    }).then((result) => {
      console.log(`[autopsy] Done for ${aeName}: ${result.dealsAnalyzed} deals`);
    }).catch((err) => {
      console.error(`[autopsy] Failed for ${aeName}: ${err.message}`);
    });
  }
}

// ─── Progression Stats API ──────────────────────────────────────
// Returns team-wide and per-rep progression stats with live Pipedrive data

const STAGE_MAPS_GLOBAL = {
  12: { 52: "early", 55: "early", 54: "early", 79: "demo", 158: "advanced", 463: "advanced", 292: "stalled", 291: "advanced", 187: "advanced", 188: "won", 159: "won", 277: "stalled" },
  70: { 474: "early", 487: "demo", 475: "early", 476: "advanced", 477: "advanced", 478: "advanced", 479: "won", 481: "lost" },
  59: { 370: "early", 371: "early", 372: "early", 373: "demo", 374: "stalled", 375: "advanced", 396: "advanced", 397: "advanced", 398: "won", 399: "won", 468: "stalled" },
  60: { 376: "early", 377: "early", 378: "early", 379: "demo", 380: "stalled", 393: "advanced", 394: "advanced", 395: "won" },
  22: { 102: "early", 103: "early", 104: "demo", 107: "demo", 141: "advanced", 108: "advanced", 105: "advanced", 106: "won" },
  11: { 46: "early", 47: "early", 48: "early", 49: "demo", 140: "advanced", 50: "advanced", 51: "advanced", 82: "won" },
  18: { 74: "early", 75: "early", 76: "advanced", 77: "advanced", 78: "won" },
  17: { 69: "early", 70: "early", 71: "advanced", 72: "advanced", 73: "won" },
  3: { 429: "demo", 10: "early", 11: "early", 12: "demo", 13: "advanced" },
  67: { 446: "demo", 447: "demo", 448: "advanced", 449: "advanced", 450: "advanced", 451: "won" },
  68: { 457: "early", 458: "demo", 459: "demo", 462: "stalled", 461: "advanced", 460: "won" },
  31: { 142: "demo", 143: "early", 144: "demo", 147: "advanced" },
  69: { 469: "early", 470: "early", 471: "demo", 472: "advanced", 473: "advanced" },
  37: { 182: "early", 183: "early", 184: "early", 185: "demo", 289: "stalled", 225: "advanced", 226: "advanced" },
};

function categorizeStage(stageId, dealStatus, pipelineId) {
  if (dealStatus === "lost") return "lost";
  if (dealStatus === "won") return "won";
  if (!stageId) return "unknown";
  const map = STAGE_MAPS_GLOBAL[pipelineId];
  if (map && map[stageId]) return map[stageId];
  return null;
}

function avgVal(arr, key) {
  const STATUS_NUMS = { strong: 3, partial: 2, weak: 1, missing: 0, none: 0 };
  const vals = arr.map((r) => r[key]).filter((v) => v != null).map((v) => typeof v === "number" ? v : STATUS_NUMS[String(v).toLowerCase().trim()] ?? null).filter((v) => v != null);
  return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3) : null;
}

async function fetchPipedriveDeal(dealId, apiKey) {
  try {
    const resp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${apiKey}`);
    const json = await resp.json();
    if (json.success && json.data) {
      return { id: json.data.id, status: json.data.status, stage_id: json.data.stage_id, value: json.data.value, pipeline_id: json.data.pipeline_id };
    }
  } catch (e) {}
  return null;
}

async function buildProgressionStats() {
  const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY;
  if (!PIPEDRIVE_KEY) throw new Error("PIPEDRIVE_API_KEY not configured");

  const data = await pool.query(`
    SELECT id, rep_name, company_name, score, rag, pipedrive_deal_id,
      score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
      spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
      bant_b, bant_a, bant_n, bant_t,
      close_style, close_setup, close_bridge, close_ask,
      call_date, duration_minutes, call_type, prospect_email
    FROM scorecards
    WHERE pipedrive_deal_id IS NOT NULL
  `);
  const rows = data.rows;

  // Fetch live deal statuses in batches
  const dealIds = [...new Set(rows.map((r) => r.pipedrive_deal_id))];
  const liveDeals = {};
  const batchSize = 10;
  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((id) => fetchPipedriveDeal(id, PIPEDRIVE_KEY)));
    results.forEach((d) => { if (d) liveDeals[d.id] = d; });
    if (i + batchSize < dealIds.length) await new Promise((r) => setTimeout(r, 500));
  }

  // Categorize each call
  rows.forEach((r) => {
    const deal = liveDeals[r.pipedrive_deal_id];
    if (deal) {
      r.liveBucket = categorizeStage(deal.stage_id, deal.status, deal.pipeline_id) || "other";
      r.liveStatus = deal.status;
      r.liveValue = deal.value;
    } else {
      r.liveBucket = "deleted";
      r.liveStatus = "unknown";
    }
  });

  const active = rows.filter((r) => r.liveBucket !== "deleted" && r.liveBucket !== "other");
  const progressed = active.filter((r) => r.liveBucket === "won" || r.liveBucket === "advanced");
  const stuck = active.filter((r) => r.liveBucket === "stalled" || r.liveBucket === "lost" || r.liveBucket === "demo" || r.liveBucket === "early");

  // Team-wide criteria averages split by outcome
  const criteriaKeys = [
    { key: "score", label: "Overall Score", max: 100 },
    { key: "score_discovery", label: "Discovery Phase", max: 32 },
    { key: "score_presentation", label: "Presentation", max: 22 },
    { key: "score_pricing", label: "Pricing & Objections", max: 28 },
    { key: "score_closing", label: "Close & Next Steps", max: 12 },
    { key: "spiced_s", label: "Situation (S)", max: 5 },
    { key: "spiced_p", label: "Pain Identified (P)", max: 5 },
    { key: "spiced_i", label: "Impact Quantified (I)", max: 5 },
    { key: "spiced_c", label: "Critical Event (C)", max: 5 },
    { key: "spiced_e", label: "Decision Mapped (E)", max: 5 },
    { key: "bant_b", label: "Budget (B)", max: 5 },
    { key: "bant_a", label: "Authority (A)", max: 5 },
    { key: "bant_n", label: "Need (N)", max: 5 },
    { key: "bant_t", label: "Timeline (T)", max: 5 },
  ];

  const teamAverages = criteriaKeys.map((c) => ({
    key: c.key,
    label: c.label,
    max: c.max,
    progressed: avgVal(progressed, c.key),
    stuck: avgVal(stuck, c.key),
    gap: (avgVal(progressed, c.key) != null && avgVal(stuck, c.key) != null)
      ? +(avgVal(progressed, c.key) - avgVal(stuck, c.key)).toFixed(3)
      : null,
  }));

  // Rank by predictive power (gap magnitude relative to stuck avg)
  const rankedPredictors = [...teamAverages]
    .filter((c) => c.gap != null && c.stuck > 0)
    .map((c) => ({ ...c, relativeGap: +((c.gap / c.stuck) * 100).toFixed(1) }))
    .sort((a, b) => Math.abs(b.relativeGap) - Math.abs(a.relativeGap));

  // Close style effectiveness
  const closeStyleMap = {};
  active.forEach((r) => {
    const style = r.close_style || "none";
    if (!closeStyleMap[style]) closeStyleMap[style] = { progressed: 0, total: 0 };
    closeStyleMap[style].total++;
    if (r.liveBucket === "won" || r.liveBucket === "advanced") closeStyleMap[style].progressed++;
  });
  const closeStyleEffectiveness = Object.entries(closeStyleMap).map(([style, d]) => ({
    style,
    total: d.total,
    progressed: d.progressed,
    rate: d.total ? +(d.progressed / d.total * 100).toFixed(1) : 0,
  })).sort((a, b) => b.total - a.total);

  // Per-rep stats
  const reps = {};
  active.forEach((r) => {
    if (!reps[r.rep_name]) reps[r.rep_name] = { all: [], progressed: [], stuck: [] };
    reps[r.rep_name].all.push(r);
    if (r.liveBucket === "won" || r.liveBucket === "advanced") reps[r.rep_name].progressed.push(r);
    else reps[r.rep_name].stuck.push(r);
  });

  const perRep = Object.entries(reps).map(([name, data]) => {
    const progRate = data.all.length ? +(data.progressed.length / data.all.length * 100).toFixed(1) : 0;
    const repAverages = {};
    for (const c of criteriaKeys) {
      repAverages[c.key] = avgVal(data.all, c.key);
    }
    // Gap between progressed vs stuck for this rep
    const repGaps = criteriaKeys.map((c) => {
      const pVal = avgVal(data.progressed, c.key);
      const sVal = avgVal(data.stuck, c.key);
      return {
        key: c.key,
        label: c.label,
        gap: (pVal != null && sVal != null) ? +(pVal - sVal).toFixed(3) : null,
      };
    }).filter((g) => g.gap != null).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    return {
      name,
      totalCalls: data.all.length,
      progressedCount: data.progressed.length,
      stuckCount: data.stuck.length,
      progressionRate: progRate,
      averages: repAverages,
      topGaps: repGaps.slice(0, 5),
    };
  }).sort((a, b) => b.progressionRate - a.progressionRate);

  return {
    generatedAt: new Date().toISOString(),
    totalCalls: rows.length,
    activeCalls: active.length,
    progressedCount: progressed.length,
    stuckCount: stuck.length,
    teamAverages,
    rankedPredictors,
    closeStyleEffectiveness,
    perRep,
  };
}

app.get("/api/progression-stats", async (req, res) => {
  try {
    const stats = await buildProgressionStats();
    res.json(stats);
  } catch (err) {
    console.error(`[/api/progression-stats] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Closed Call Examples API ──────────────────────────────────
// Returns top scored calls where the linked deal was won

app.get("/api/closed-call-examples", async (req, res) => {
  try {
    const PIPEDRIVE_KEY = process.env.PIPEDRIVE_API_KEY;
    if (!PIPEDRIVE_KEY) throw new Error("PIPEDRIVE_API_KEY not configured");

    const data = await pool.query(`
      SELECT id, rep_name, company_name, score, rag, verdict,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        close_style, close_setup, close_bridge, close_ask,
        call_date, pipedrive_deal_id, title, scorecard_json
      FROM scorecards
      WHERE pipedrive_deal_id IS NOT NULL
      ORDER BY score DESC
      LIMIT 50
    `);

    const rows = data.rows;
    const dealIds = [...new Set(rows.map((r) => r.pipedrive_deal_id))];

    // Fetch live deal statuses
    const liveDeals = {};
    const batchSize = 10;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((id) => fetchPipedriveDeal(id, PIPEDRIVE_KEY)));
      results.forEach((d) => { if (d) liveDeals[d.id] = d; });
      if (i + batchSize < dealIds.length) await new Promise((r) => setTimeout(r, 500));
    }

    // Filter to won deals only
    const wonCalls = rows.filter((r) => {
      const deal = liveDeals[r.pipedrive_deal_id];
      return deal && deal.status === "won";
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    const appUrl = process.env.APP_URL || "";
    const examples = wonCalls.map((r) => {
      const spicedStrengths = ["s", "p", "i", "c", "e"]
        .filter((el) => r[`spiced_${el}`] === "strong")
        .map((el) => ({ s: "Situation", p: "Pain", i: "Impact", c: "Critical Event", e: "Decision" }[el]));

      let closeStyle = r.close_style || "none";
      const closeSteps = ["setup", "bridge", "ask"]
        .filter((step) => r[`close_${step}`] === "strong")
        .map((step) => step.charAt(0).toUpperCase() + step.slice(1));

      let verdictText = r.verdict || "";
      if (verdictText.startsWith("_") && verdictText.endsWith("_")) {
        verdictText = verdictText.slice(1, -1);
      }

      return {
        id: r.id,
        repName: r.rep_name,
        company: r.company_name,
        score: r.score,
        rag: r.rag,
        verdict: verdictText,
        spicedStrengths,
        closeStyle,
        closeSteps,
        callDate: r.call_date,
        scorecardUrl: appUrl ? `${appUrl}/calls/${r.id}` : null,
      };
    });

    res.json({ examples, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error(`[/api/closed-call-examples] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Deal Autopsy API ──────────────────────────────────────────
// Analyzes what differentiated the calls that led to won deals.
//
// Query params:
//   ?dealId=123         — autopsy a specific won Pipedrive deal
//   ?rep=Vanessa&days=30 — autopsy recent won deals for a rep
//
// Returns structured analysis of winning call patterns vs lost deals.

app.get("/api/deal-autopsy", async (req, res) => {
  try {
    const { dealId, rep, days } = req.query;
    const pipedriveKey = process.env.PIPEDRIVE_API_KEY;
    const firefliesKey = process.env.FIREFLIES_API_KEY;

    if (!pipedriveKey) throw new Error("PIPEDRIVE_API_KEY not configured");
    if (!firefliesKey) throw new Error("FIREFLIES_API_KEY not configured");

    if (!dealId && !rep) {
      return res.status(400).json({ error: "Provide ?dealId=X or ?rep=NAME (optionally ?days=30)" });
    }

    console.log(`[/api/deal-autopsy] dealId=${dealId || "N/A"} rep=${rep || "N/A"} days=${days || 30}`);

    const result = await runDealAutopsy({
      dealId: dealId || null,
      repName: rep || null,
      days: parseInt(days) || 30,
      pool,
      pipedriveKey,
      firefliesKey,
    });

    res.json(result);
  } catch (err) {
    console.error(`[/api/deal-autopsy] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Static Dashboard ──────────────────────────────────────────
const path = require("path");
const fs = require("fs");

app.get("/dashboard", (req, res) => {
  const htmlPath = path.join(__dirname, "..", "web-static", "progression-dashboard.html");
  try {
    const html = fs.readFileSync(htmlPath, "utf8");
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(404).send("Dashboard not found");
  }
});

// ─── Team Autopsy API ──────────────────────────────────────────
// Runs won-deal autopsy for all active AEs in one request.
// GET /api/team-autopsy — returns analysis for all reps with won deals

app.get("/api/team-autopsy", async (req, res) => {
  try {
    const pipedriveKey = process.env.PIPEDRIVE_API_KEY;
    const firefliesKey = process.env.FIREFLIES_API_KEY;
    if (!pipedriveKey) throw new Error("PIPEDRIVE_API_KEY not configured");
    if (!firefliesKey) throw new Error("FIREFLIES_API_KEY not configured");

    // Get distinct reps with won deals in the DB
    const { rows } = await pool.query(`
      SELECT DISTINCT rep_name FROM scorecards
      WHERE pipedrive_deal_id IS NOT NULL
      ORDER BY rep_name
    `);
    const reps = rows.map(r => r.rep_name);

    console.log(`[/api/team-autopsy] Running for ${reps.length} reps: ${reps.join(", ")}`);

    const results = {};
    for (const rep of reps) {
      try {
        console.log(`[/api/team-autopsy] Analyzing ${rep}...`);
        const result = await runDealAutopsy({
          repName: rep,
          days: 90,
          pool,
          pipedriveKey,
          firefliesKey,
        });
        results[rep] = {
          dealsAnalyzed: result.dealsAnalyzed,
          autopsies: result.autopsies,
        };
      } catch (e) {
        results[rep] = { error: e.message };
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      repsAnalyzed: reps.length,
      results,
    });
  } catch (err) {
    console.error(`[/api/team-autopsy] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Autopsy History API ──────────────────────────────────────
// Retrieves saved autopsy results from the database.
// GET /api/autopsy-history?rep=Vanessa&limit=5
// GET /api/autopsy/:id

app.get("/api/autopsy-history", async (req, res) => {
  try {
    const { rep, limit } = req.query;
    let query = `SELECT id, rep_name, deal_id, deal_title, deal_value, call_count, won_avg_score, comparison_calls, summary, key_differentiators, coaching_insight, winning_close_style, status, generated_at FROM autopsies`;
    const params = [];

    if (rep) {
      query += ` WHERE rep_name ILIKE $1`;
      params.push(`${rep}%`);
    }
    query += ` ORDER BY generated_at DESC LIMIT $${params.length + 1}`;
    params.push(String(parseInt(limit) || 20));

    const { rows } = await pool.query(query, params);
    res.json({ autopsies: rows, count: rows.length });
  } catch (err) {
    console.error(`[/api/autopsy-history] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/autopsy/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM autopsies WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Autopsy not found" });
    }
    res.json({ autopsy: rows[0] });
  } catch (err) {
    console.error(`[/api/autopsy/:id] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Backfill Endpoint ──────────────────────────────────────────
// POST /api/backfill — score recent transcripts without posting to Slack
// Body: { "meetingIds": ["id1","id2",...] }
// Processes each: fetch → resolve team → score → save (no Slack, no autopsy)
app.post("/api/backfill", async (req, res) => {
  const { meetingIds } = req.body;
  if (!Array.isArray(meetingIds) || meetingIds.length === 0) {
    return res.status(400).json({ error: "meetingIds array required" });
  }

  console.log(`\n[backfill] Starting bulk scoring for ${meetingIds.length} meetings...`);

  // Acknowledge immediately — process async
  res.json({ status: "processing", count: meetingIds.length });

  const results = [];
  for (const meetingId of meetingIds) {
    try {
      // Check already scored
      const existing = await pool.query(
        `SELECT id FROM scorecards WHERE meeting_id = $1`, [meetingId]
      );
      if (existing.rows.length > 0) {
        console.log(`[backfill] ${meetingId}: already scored (${existing.rows[0].id})`);
        results.push({ meetingId, status: "skipped", reason: "already scored" });
        continue;
      }

      // Fetch transcript
      const transcript = await fetchTranscript(meetingId);
      console.log(`[backfill] ${meetingId}: "${transcript.title}" (${transcript.durationMinutes}min, ${transcript.repName})`);

      // Resolve team
      const organizerEmail = transcript.participants?.find(p => {
        const email = (typeof p === "string" ? p : p?.email || "").toLowerCase();
        return email.includes("@");
      }) || "";
      const orgEmail = (typeof organizerEmail === "string" ? organizerEmail : organizerEmail?.email || "").toLowerCase();
      const teamMatch = await resolveTeam(orgEmail);
      if (!teamMatch) {
        console.log(`[backfill] ${meetingId}: no team match for ${orgEmail}`);
        results.push({ meetingId, status: "skipped", reason: "no team match" });
        continue;
      }
      const { teamId, aeEntry } = teamMatch;
      const teamSettings = await getTeamSettings(teamId);
      const aeEmails = buildAeEmailSet(teamSettings.ae_roster || []);
      const prospectEmail = extractProspectEmail(transcript.participants, aeEmails);

      // Detect followup
      const { isFollowup, priorCallContext } = await detectFollowup(
        transcript.repName, transcript.companyName, prospectEmail, transcript.title
      );
      const callType = isFollowup ? "followup" : "discovery";

      // Score
      const scoringArgs = {
        transcriptText: transcript.transcriptText,
        repName: transcript.repName,
        companyName: transcript.companyName,
        durationMinutes: transcript.durationMinutes,
        meetingId
      };
      if (isFollowup) {
        scoringArgs.systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
        scoringArgs.userPrompt = buildFollowupScoringPrompt(
          transcript.transcriptText, transcript.repName, transcript.companyName,
          transcript.durationMinutes, priorCallContext
        );
      }
      const scorecard = await scoreTranscript(scoringArgs);
      console.log(`[backfill] ${meetingId}: scored ${scorecard.score}/100 (${scorecard.rag})`);

      // Save
      const meta = {
        repName: transcript.repName,
        companyName: transcript.companyName,
        date: transcript.date,
        durationMinutes: transcript.durationMinutes,
        meetingId,
        callType,
        prospectEmail,
        teamId
      };
      const scorecardId = await saveScorecard(scorecard, meta);
      console.log(`[backfill] ${meetingId}: saved as ${scorecardId}`);

      // Pipedrive lookup
      if (process.env.PIPEDRIVE_API_KEY && meta.prospectEmail) {
        try {
          const pdResp = await fetch(
            `https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(meta.prospectEmail)}&limit=3&api_token=${process.env.PIPEDRIVE_API_KEY}`
          );
          const pdData = await pdResp.json();
          if (pdData.success && pdData.data?.items?.[0]?.item) {
            const dealsResp = await fetch(
              `https://api.pipedrive.com/v1/persons/${pdData.data.items[0].item.id}/deals?api_token=${process.env.PIPEDRIVE_API_KEY}`
            );
            const dealsData = await dealsResp.json();
            if (dealsData.success && dealsData.data?.length > 0) {
              const deal = dealsData.data[0];
              await pool.query(
                `UPDATE scorecards SET pipedrive_deal_id=$1, pipedrive_deal_stage=$2, pipedrive_deal_value=$3 WHERE id=$4`,
                [String(deal.id), String(deal.stage_id), deal.value || null, scorecardId]
              );
            }
          }
        } catch (e) {}
      }

      results.push({ meetingId, status: "scored", scorecardId, score: scorecard.score, rep: transcript.repName });

      // Brief pause between calls to avoid hammering APIs
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[backfill] ${meetingId}: FAILED — ${err.message}`);
      results.push({ meetingId, status: "error", error: err.message });
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[backfill] Complete: ${results.filter(r => r.status === "scored").length} scored, ${results.filter(r => r.status === "skipped").length} skipped, ${results.filter(r => r.status === "error").length} errors`);
});

// ─── Test Slack Notification ────────────────────────────────────
// GET /api/test-slack — fires a sample notification to verify the pipeline
app.get("/api/test-slack", async (req, res) => {
  try {
    const repName = req.query.rep || "Vanessa Fortune";
    console.log(`[test-slack] Firing test notification for ${repName}...`);

    // Build a fake scorecard
    const scorecard = {
      score: 72,
      rag: "yellow",
      verdict: `${repName.split(" ")[0]} ran a solid discovery call — good agenda setting and rapport. Room to grow on impact quantification and close execution.`,
      phases: {
        preCall: { score: 4, maxPoints: 6 },
        discovery: { score: 21, maxPoints: 32 },
        presentation: { score: 16, maxPoints: 22 },
        pricing: { score: 19, maxPoints: 28 },
        closing: { score: 8, maxPoints: 12 },
      },
      spiced: {
        s: { score: 4, status: "strong", feedback: "Good situation mapping" },
        p: { score: 3, status: "partial", feedback: "Pain identified but not fully explored" },
        i: { score: 2, status: "partial", feedback: "Impact needs quantification" },
        c: { score: 3, status: "partial", feedback: "Some urgency established" },
        e: { score: 4, status: "strong", feedback: "Decision process well mapped" },
      },
      bant: {
        b: { score: 2, status: "partial", feedback: "Budget mentioned but not nailed down" },
        a: { score: 4, status: "strong", feedback: "Confirmed decision-maker on call" },
        n: { score: 4, status: "strong", feedback: "Clear need established" },
        t: { score: 3, status: "partial", feedback: "Timeline discussed, not locked" },
      },
      close: {
        style: "consultative",
        styleName: "Consultative Close",
        setup: { score: 3, status: "strong", label: "Summarize Value", feedback: "Good value recap" },
        bridge: { score: 2, status: "partial", label: "Surface Blockers", feedback: "Could probe deeper on hesitation" },
        ask: { score: 2, status: "partial", label: "Ask for Commitment", feedback: "Ask was soft — try a direct commitment ask next time" },
      },
      wins: [
        "Set a clear agenda and got prospect buy-in at 01:45",
        "Built strong rapport — prospect shared unguarded pain points",
        "Mapped decision process including legal review timeline",
      ],
      fixes: [
        "Try quantifying impact next time — ask 'what does this problem cost you per month?'",
        "The close was a soft 'shall I send a proposal?' — try 'can we get you started on the monthly plan today?'",
      ],
      closingTips: [
        "After presenting pricing, stay silent and let the prospect respond first",
        "Tie the ask to the prospect's own urgency — reference their timeline when closing",
        "If they hesitate, isolate the objection: 'other than price, is there anything holding you back?'",
      ],
      quoteOfTheCall: {
        text: "This is exactly what we've been looking for — we just need to figure out the timing.",
        timestamp: "18:42",
        context: "Strong buying signal — rep should have locked in a specific date here instead of saying 'I'll follow up'",
      },
      flags: {
        enthusiasm: { detected: true, note: "High energy throughout" },
        unprofessionalLanguage: { detected: false, note: "" },
        prematureDisqualification: { detected: false, note: "" },
      },
    };

    // Fetch team settings to get roster/channel info
    let teamConfig = {};
    try {
      const teamResult = await pool.query(
        `SELECT s.key, s.value FROM settings s WHERE s.key IN ('ae_roster', 'slack_channel_reviews', 'slack_bot_token', 'app_url')`
      );
      for (const row of teamResult.rows) {
        try {
          teamConfig[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        } catch {
          teamConfig[row.key] = row.value;
        }
      }
      console.log(`[test-slack] Settings keys found: ${teamResult.rows.map(r => r.key).join(", ")}`);
    } catch (err) {
      console.error(`[test-slack] Failed to fetch settings: ${err.message}`);
    }

    // Fallback to env vars for channel/token
    const roster = Array.isArray(teamConfig.ae_roster) ? teamConfig.ae_roster : [];
    const channelId = teamConfig.slack_channel_reviews || process.env.SLACK_CHANNEL_REVIEWS;
    const slackBotToken = teamConfig.slack_bot_token || process.env.SLACK_BOT_TOKEN;

    const meta = {
      repName,
      companyName: "Acme Corp (Test)",
      durationMinutes: 28,
      meetingId: "test-" + Date.now(),
      callType: "discovery",
      pipedriveDealId: "29",
      pipedriveDealTitle: "K.A.G. Polytech (Test)",
      pipedriveDealValue: 7000,
      pipedriveDealStage: "Demo Held",
      recentAvg: 64,
      recentCount: 5,
    };

    console.log(`[test-slack] Channel: ${channelId || "NOT SET"}, Roster: ${roster.length} AEs`);

    if (!channelId) {
      return res.json({ error: "No Slack channel configured", teamConfig });
    }

    // Try direct Slack API call to surface exact error
    const { WebClient } = require("@slack/web-api");
    const slackTest = new WebClient(slackBotToken);
    try {
      const slackResult = await slackTest.chat.postMessage({
        channel: channelId,
        text: "🔧 *Killer Calls test notification* — Slack pipeline is live! 🎉\n\nFull notifications will include: scorecard, SPICED/BANT/Close pips, stall risk, Pipedrive deal link, and a coaching thread.",
        unfurl_links: false,
      });
      console.log(`[test-slack] ✅ Test message posted! ts=${slackResult.ts}`);

      // Now post the full demo review
      const result = await postDemoReview(scorecard, meta, "test-" + Date.now(), {
        channelId,
        roster,
        slackBotToken,
      });

      res.json({
        status: "ok",
        test_ts: slackResult.ts,
        review_result: result ? { ts: result.ts } : null,
        channel: channelId,
        rep: repName,
      });
    } catch (slackErr) {
      console.error(`[test-slack] Slack API error: ${slackErr.message}`);
      res.json({
        status: "failed",
        slack_error: slackErr.message,
        slack_code: slackErr.code,
        slack_data: slackErr.data,
        channel: channelId,
        rep: repName,
      });
    }
  } catch (err) {
    console.error(`[test-slack] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ────────────────────────────────────────────────

function validateEnv() {
  const scoringBackend = process.env.SCORING_BACKEND || "openclaw";
  const required = ["FIREFLIES_API_KEY", "DATABASE_URL"];
  if (scoringBackend === "anthropic") { required.push("ANTHROPIC_API_KEY"); }
  const optional = ["SLACK_BOT_TOKEN", "SLACK_CHANNEL_REVIEWS", "SLACK_CHANNEL_KILLER"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(", ")}`);
    console.error("   The server will start but features requiring these keys will fail gracefully.");
    // WARN instead of killing — avoids crash loops on Railway
  }

  const missingOptional = optional.filter((key) => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn(`⚠️  Missing optional env vars (Slack won't post): ${missingOptional.join(", ")}`);
  }
}

// ─── Run pending migrations ─────────────────────────────────────

async function runMigrations() {
  try {
    // Create autopsies table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS autopsies (
        id SERIAL PRIMARY KEY,
        rep_name VARCHAR(255) NOT NULL,
        deal_id VARCHAR(50),
        deal_title VARCHAR(500),
        deal_value NUMERIC(12,2),
        call_count INTEGER DEFAULT 0,
        won_avg_score NUMERIC(5,1),
        comparison_calls INTEGER DEFAULT 0,
        summary TEXT,
        key_differentiators JSONB DEFAULT '[]',
        patterns_to_replicate JSONB DEFAULT '[]',
        coaching_insight TEXT,
        winning_close_style TEXT,
        full_analysis JSONB DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'analyzed',
        error_message TEXT,
        generated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_autopsies_rep_name ON autopsies(rep_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_autopsies_deal_id ON autopsies(deal_id)`);
    console.log("[migrations] Autopsies table ready");
  } catch (e) {
    console.error("[migrations] Failed:", e.message);
  }
}

// ─── Crash Protection ────────────────────────────────────────────
// Prevents process death from unhandled rejections and uncaught exceptions.
// Railway restarts on exit, so these keep the service alive for investigation.

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit — let the server stay up and serve other requests
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.message, err.stack);
  // Don't exit — prevents crash loops on Railway
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[shutdown] SIGTERM received — closing gracefully");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[shutdown] SIGINT received — closing gracefully");
  process.exit(0);
});

validateEnv();
runMigrations();

// ─── Health check endpoint ───────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: {
      fireflies: !!process.env.FIREFLIES_API_KEY,
      database: !!process.env.DATABASE_URL,
      pipedrive: !!process.env.PIPEDRIVE_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      openrouter: !!process.env.OPENROUTER_API_KEY,
      slack: !!process.env.SLACK_BOT_TOKEN,
      slack_token_preview: process.env.SLACK_BOT_TOKEN
        ? process.env.SLACK_BOT_TOKEN.substring(0, 14) + "..."
        : null,
    }
  });
});

app.listen(CONFIG.port, () => {
  console.log(`\n🚀 Killer Calls running on port ${CONFIG.port} (multi-team)`);
  console.log(`   Webhook URL: POST http://localhost:${CONFIG.port}/webhook/fireflies`);
  console.log(`   Health check: GET http://localhost:${CONFIG.port}/`);
  const backend = process.env.SCORING_BACKEND || "openclaw";
  console.log(`   Scoring backend: ${backend}${backend === "anthropic" ? " (model: " + CONFIG.claudeModel + ")" : " (via OpenClaw Gateway)"}`);
});
