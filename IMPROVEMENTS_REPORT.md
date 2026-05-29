# Killer Calls — Improvements Report

**Date:** May 29, 2026
**Branch:** `builder/unify-retry-headers`
**Scope:** Architecture review top 3 fixes

---

## TASK 1 — Unify Scoring Prompts (Single Source of Truth)

**Commit:** `45d66f5`
**Files changed:** 6

**What was wrong:**
The scoring rubric, system prompt, and followup detection logic existed in 3 separate files across 2 languages:
- `src/scoring-engine.js` (376 lines of prompts)
- `web/src/lib/scoring-prompts.ts` (613 lines of prompts)
- `poller.js` (embedded prompts inline)

The SPICED labels had already drifted between the Railway and Vercel versions. Every rubric change required 3 edits.

**What was done:**
- Extracted all prompts into `shared/scoring-prompts.js` — single source of truth
- `src/scoring-engine.js` now imports from the shared module
- `web/src/lib/scoring-prompts.ts` now re-exports from the shared module
- `poller.js` now imports prompts dynamically from the shared module
- Followup detection logic (`detectFollowup`, `buildFollowupContext`) extracted to `shared/followup-detection.js`
- The Vercel version was used as canonical (more current SPICED labels)

**Result:** One file to change for any rubric or prompt update. All 3 pipelines produce identical prompts.

---

## TASK 2 — Add Retry with Backoff to Scoring Pipeline

**Commit:** `79992b4`
**Files changed:** 2 (`src/index.js`, new `shared/retry.js`)

**What was wrong:**
If DeepSeek timed out or returned garbage JSON, the call was permanently lost. No retry, no fallback. At 200 calls/day with 1% failure rate, 2 lost scorecards daily.

**What was done:**
- Added `retryWithBackoff()` utility in `shared/retry.js`
- 3 attempts with exponential backoff: 2s, 8s, 30s
- Distinguishes API errors from timeouts via `AbortController` signal
- On final failure, inserts into `pending_scores` table for the local poller to pick up
- Every attempt logged to console with attempt number and error details

**Result:** Transient DeepSeek failures no longer lose calls permanently. Fallback to local poller ensures eventual scoring.

---

## TASK 3 — Move Pipedrive API Key from Query Strings to Headers

**Commit:** `f33af23` 
**Files changed:** 10 (21 instances fixed)

**What was wrong:**
`?api_token=${PIPEDRIVE_API_KEY}` was appended to every Pipedrive API call URL. This key appeared in Pipedrive access logs, Railway logs, proxy logs, and error messages. The key has full deal read/write access.

**What was done:**
- Replaced all `?api_token=` and `&api_token=` with `X-Api-Token` HTTP header
- Files changed:
  - `src/index.js` — 8 instances
  - `src/deal-autopsy.js` — 2 instances
  - `poller.js` — 3 instances
  - `scripts/weekly-coaching-digest.js` — 1 instance
  - `deal-progression-analysis.js` — 1 instance
  - `correlation-analysis-live.js` — 2 instances
  - `backfill-pipedrive.js` — 1 instance
  - `backfill-pedro.js` — 1 instance
  - `fix-all-emails.js` — 1 instance
  - `fix-pedro-emails.js` — 1 instance
- Verified: zero `api_token` strings remain in the codebase

**Result:** Pipedrive API key no longer leaked in URLs, logs, or error messages.

---

## Verification Checklist

- [ ] Deploy to Railway staging and verify webhook scoring still works
- [ ] Verify Pipedrive queries return expected results with header auth
- [ ] Run one backfill script to confirm header auth works in utility scripts
- [ ] Monitor scoring failures for a day to confirm retry logic fires correctly
- [ ] Confirm prompt output is identical before/after for the same call
