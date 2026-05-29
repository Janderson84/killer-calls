// ─── Killer Calls Scoring Engine ─────────────────────────────────
// Sends call transcripts to DeepSeek for scoring against the
// SalesCloser.ai rubric. Returns a structured JSON scorecard.
// Requires: DEEPSEEK_API_KEY environment variable.
//
// Prompts are sourced from shared/scoring-prompts.js (single source of truth).
// This module re-exports them for backward compatibility with existing consumers.

// ─── Import shared prompts (single source of truth) ─────────────
const {
  SCORING_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  DEFAULT_WEIGHTS,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
  buildScoringPromptWithWeights,
} = require("../shared/scoring-prompts");

// Backward compat: SYSTEM_PROMPT was the old export name
const SYSTEM_PROMPT = SCORING_SYSTEM_PROMPT;

// ─── Scorecard parser ─────────────────────────────────────────────

function parseScorecardText(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.includes('```')) {
    const match = cleaned.match(/```(?:json)?[\s]*\n?([\s\S]*?)\n?```/);
    if (match) cleaned = match[1];
  }
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  let scorecard;
  try {
    scorecard = JSON.parse(cleaned);
  } catch (err) {
    // If JSON is truncated, try to salvage by closing braces
    if (err.message.includes('Unexpected end') && cleaned.startsWith('{')) {
      // Count open vs close braces and add missing ones
      let open = 0;
      for (const ch of cleaned) {
        if (ch === '{') open++;
        if (ch === '}') open--;
      }
      const salvaged = cleaned + '}'.repeat(Math.max(0, open));
      try {
        scorecard = JSON.parse(salvaged);
        console.warn('[scoring] Truncated JSON salvaged by adding ' + Math.max(0, open) + ' closing braces');
      } catch (e2) {
        throw new Error('DeepSeek returned truncated/unparseable JSON. Partial: ' + cleaned.substring(0, 300));
      }
    } else {
      throw new Error('DeepSeek returned invalid JSON: ' + err.message + '. Partial: ' + cleaned.substring(0, 300));
    }
  }
  if (typeof scorecard.score !== 'number' || !scorecard.rag) {
    throw new Error('Scoring response missing required fields (score, rag)');
  }

  // Ensure close object always exists
  if (!scorecard.close) {
    scorecard.close = {
      style: 'none',
      styleName: 'No Close Detected',
      setup: { score: 0, status: 'missing', label: 'No setup detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
      bridge: { score: 0, status: 'missing', label: 'No bridge detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
      ask: { score: 0, status: 'missing', label: 'No ask detected', feedback: 'No close execution was detected in this call.', timestamps: [] },
    };
  }

  return scorecard;
}

// ─── Main scoring function (DeepSeek only) with retry ───────────

const RETRY_CONFIG = {
  maxAttempts: 3,
  delaysMs: [2000, 8000, 30000],       // exponential backoff
  timeoutMs: 300000,                     // 5 minutes
};

/**
 * Single attempt to call DeepSeek. Uses manual AbortController for
 * distinguishable timeout (vs AbortSignal.timeout which conflates).
 */
async function _scoreOnce(effectiveSystemPrompt, effectiveUserPrompt, timeoutMs) {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const payload = {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: effectiveSystemPrompt },
      { role: "user", content: effectiveUserPrompt },
    ],
    temperature: 0.3,
    max_tokens: 16384,
    response_format: { type: "json_object" },
  };

  // Use manual AbortController so we can set a descriptive reason string.
  // This distinguishes "API slow" (timeout) from "API error" (non-200, etc.)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`DeepSeek API timeout after ${timeoutMs / 1000}s`));
  }, timeoutMs);

  try {
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await resp.text();

    if (resp.status !== 200) {
      throw new Error("DeepSeek API " + resp.status + ": " + data.substring(0, 200));
    }

    let json;
    try {
      json = JSON.parse(data);
    } catch (err) {
      throw new Error("DeepSeek returned non-JSON response (status " + resp.status + "). Raw: " + data.substring(0, 200));
    }

    // Check for API-level errors (DeepSeek returns 200 with error object on auth failures)
    if (json.error) {
      const errMsg = json.error.message || JSON.stringify(json.error);
      throw new Error("DeepSeek API error: " + errMsg);
    }

    const text = json.choices?.[0]?.message?.content;
    if (!text || text.trim().length === 0) {
      throw new Error("DeepSeek returned empty response. Raw: " + data.substring(0, 300));
    }

    return parseScorecardText(text);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scoreTranscript({ transcriptText, repName, companyName, durationMinutes, systemPrompt, userPrompt, meetingId }) {
  const effectiveSystemPrompt = systemPrompt || SYSTEM_PROMPT;
  const effectiveUserPrompt = userPrompt || buildScoringPrompt(transcriptText, repName, companyName, durationMinutes);

  const prefix = meetingId ? `[scoring ${meetingId.substring(0, 8)}]` : "[scoring]";

  console.log(`${prefix} Backend: deepseek (retry: up to ${RETRY_CONFIG.maxAttempts} attempts)`);

  let lastError = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    const delay = RETRY_CONFIG.delaysMs[attempt - 1] || 0;

    if (attempt > 1) {
      console.log(`${prefix} Retry attempt ${attempt}/${RETRY_CONFIG.maxAttempts} after ${delay / 1000}s delay (previous: ${lastError.message.substring(0, 120)})`);
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      console.log(`${prefix} Attempt ${attempt}/${RETRY_CONFIG.maxAttempts} — calling DeepSeek...`);
      const result = await _scoreOnce(effectiveSystemPrompt, effectiveUserPrompt, RETRY_CONFIG.timeoutMs);
      console.log(`${prefix} Attempt ${attempt} — success (score: ${result.score})`);
      return result;
    } catch (err) {
      lastError = err;
      const isTimeout = err.name === "AbortError" && err.message?.includes("timeout");
      const errorType = isTimeout ? "TIMEOUT" : "ERROR";
      console.error(`${prefix} Attempt ${attempt} FAILED [${errorType}]: ${err.message.substring(0, 200)}`);

      // Non-retryable: auth errors, bad requests
      if (err.message.includes("401") || err.message.includes("403") || err.message.includes("not configured")) {
        console.error(`${prefix} Non-retryable error — aborting`);
        break;
      }
    }
  }

  // All attempts exhausted
  throw new Error(`Scoring failed after ${RETRY_CONFIG.maxAttempts} attempts. Last error: ${lastError.message}`);
}

module.exports = {
  scoreTranscript,
  SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  buildScoringPrompt,
  buildFollowupScoringPrompt,
  buildScoringPromptWithWeights,
};
