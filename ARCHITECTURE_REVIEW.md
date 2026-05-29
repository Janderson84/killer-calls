# Killer Calls — Architecture Review

**Date:** May 29, 2026
**Version:** 2.2.0 (as deployed)
**Reviewer:** Builder (staff engineer)

---

## 1. Architecture Map

### System Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        FIREFLIES.AI                              │
│  Sends webhook POST when transcript ready                        │
└────────────┬──────────────────────────┬─────────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌─────────────────────────────────────┐
│  RAILWAY (Express)     │  │  VERCEL (Next.js)                    │
│  src/index.js          │  │  web/src/app/api/poll/route.ts       │
│  - /webhook/fireflies  │  │  - Cron-driven poller               │
│  - /score (internal)   │  │  - Dashboard (SSR via neon())        │
│  - /api/progression-*   │  │  - Team pages, call detail, etc.    │
│  - /api/deal-autopsy   │  │                                      │
│  - /api/team-autopsy   │  │                                      │
│  - /api/rep-pipeline   │  │                                      │
│  scoring-engine.js →   │  │  lib/scoring-prompts.ts →            │
│    DeepSeek API         │  │    Railway /score endpoint          │
│  fireflies-client.js   │  │  lib/slack-formatter.ts              │
│  slack-formatter.js    │  │  lib/db.ts → Neon                    │
│  db.js                 │  │                                      │
└───────────┬────────────┘  └──────────────┬──────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     NEON POSTGRES                                │
│  scorecards, reps, teams, settings, skipped_meetings,           │
│  autopsies, pending_scores, playbook_examples                   │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  LOCAL POLLER (poller.js)                                       │
│  - Runs on local machine via cron                               │
│  - Scores via OpenClaw CLI (execSync)                           │
│  - Processes pending_scores from cloud deployments              │
│  - Posts to Slack                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow (Happy Path)

```
Fireflies webhook → Railway POST /webhook/fireflies
  → return 200 immediately
  → async processDemo():
    1. Dedup check (in-memory Set + skipped_meetings table)
    2. Fireflies GraphQL → full transcript
    3. resolveTeam() → DB settings lookup
    4. detectFollowup() → DB prior calls lookup
    5. scoreTranscript() → DeepSeek API (5 min timeout)
    6. saveScorecard() → Neon Postgres
    7. Pipedrive deal lookup → 2-3 API calls
    8. postDemoReview() → Slack #demo-reviews
    9. postKillerCall() → Slack #killer-calls (if ≥80)
    10. runDealAutopsy() → background async (fire and forget)
```

### Alternative Pipeline (Vercel Cron)

```
Vercel cron → GET /api/poll (every 30 min)
  → For each active AE: Fireflies recent transcripts query
  → Filter out already scored/skipped
  → For each new call:
    → fetchTranscript() → Fireflies GraphQL
    → detectFollowup() → DB queries
    → scoreCall() → Railway POST /score
    → save directly to Neon via sql``
    → postDemoReview()/postKillerCall() → Slack
```

### Critical Observation: Two Competing Pipelines

The Vercel poller and Railway webhook **both process calls independently** and both write directly to the database. The only coordination mechanism is:
- `skipped_meetings` table (INSERT ON CONFLICT as a claim/lock)
- `inFlightMeetings` Set (process memory only, Railway only)

This is **fragile** — there's no distributed lock, no message queue, no single arbiter of "who scores what."

---

## 2. Evaluation

### Reliability

| Concern | Rating | Detail |
|---------|--------|--------|
| Webhook loss | **HIGH RISK** | `processDemo().catch(console.error)` — no retry, no dead letter queue. If Fireflies sends 3 rapid webhooks and DeepSeek is slow on the first, calls 2 and 3 hit the in-memory dedup and are correctly skipped. But if the process crashes midway, the call is permanently lost. |
| Scoring failure | **MEDIUM RISK** | DeepSeek has a 5-min timeout. If it times out or returns garbage JSON, the error is logged and the call is dropped. No retry with backoff. The `skipped_meetings` claim is cleaned up in the catch block, allowing retry on next webhook — but Fireflies won't resend. |
| DB connection | **LOW RISK** | Neon is managed, connection pooling exists. But no retry wrapper on transient failures — a blip during `saveScorecard()` loses everything upstream. |
| Slack delivery | **LOW RISK** | `postDemoReview` catches errors and returns null. Call is scored and saved even if Slack fails. |
| Single process | **MEDIUM RISK** | Railway runs one Express instance. If it restarts (deploy, crash), in-flight scorings are lost. The `skipped_meetings` claim partially mitigates this — next webhook can retry — but the original webhook won't re-fire. |

**Summary:** The system survives component failures gracefully in most cases (Slack down, Pipedrive slow), but **a crash during scoring loses the call permanently** unless Fireflies resends the webhook (which it may not).

### Maintainability

| Concern | Rating | Detail |
|---------|--------|--------|
| Monolithic index.js | **POOR** | 1771 lines. Every API route, pipeline step, and utility lives in one file. Extracting any logic requires surgery. |
| Duplicate code | **CRITICAL** | The scoring prompts exist in 3 places: `src/scoring-engine.js` (376 lines), `web/src/lib/scoring-prompts.ts` (613 lines), and `poller.js` (embedded). The followup detection logic is duplicated in `index.js` and `poll/route.ts`. The transcript fetching logic exists in `fireflies-client.js` and is reimplemented in `poll/route.ts`. Every rubric change must be made in 2-3 files. |
| Hardcoded values | **POOR** | Team ID `1f7fb17c-...` hardcoded in 3 places. AE email list duplicated. Scoring weights embedded in prompts. |
| Module boundaries | **FAIR** | `db.js`, `fireflies-client.js`, `slack-formatter.js` are clean modules. `scoring-engine.js` is self-contained. But `index.js` violates all boundaries — it imports from modules then does everything in one function. |
| Testability | **NONE** | Zero tests. Every function is deeply coupled to external APIs. `scoreTranscript()` directly calls `fetch()` — can't test without mocking the network. |

**Summary:** The codebase is **hard to change safely**. A prompt tweak requires editing 2-3 files in different languages (JS + TS). There's no test safety net. The monolith is showing strain.

### Performance

| Concern | Rating | Detail |
|---------|--------|--------|
| Scoring latency | **ACCEPTABLE** | DeepSeek takes 30-90 seconds per call. The 5-min timeout is generous. Pipeline is async so webhook returns instantly. |
| Dashboard queries | **FAIR** | `page.tsx` runs multiple aggregations server-side on every request. No caching. With 200+ calls/day, these will slow down. The progression-stats endpoint re-fetches ALL Pipedrive deal statuses live — 50+ API calls. |
| Token waste in prompts | **HIGH** | Every scoring call sends the FULL rubric (~3,000 words) in the user prompt, plus a ~2,000 word system prompt. For a 30-min transcript (~8,000 words), that's ~13,000 tokens per call. At 200 calls/day: ~2.6M tokens/day. Estimated cost: $5-10/day just in unnecessary rubric redundancy. |
| Poller blocking | **POOR** | `poller.js` uses `execSync` to shell out to OpenClaw. This blocks the Node event loop entirely during scoring (up to 6 minutes). No parallelism. The Vercel poll route uses `await scoreCall()` which is async but single-threaded per invocation. |
| N+1 Pipedrive queries | **POOR** | `/api/progression-stats` fetches deal statuses one at a time with 500ms delays. `/api/rep-pipeline` does the same. A lot of sequential waiting. Though batched in groups of 5-10, the stage name resolution is per-stage-ID sequentially. |

**Summary:** The scoring pipeline is latency-tolerant (async), but **token costs are 40-60% higher than necessary** due to prompt bloat, and dashboard endpoints will degrade as data grows.

### Security

| Concern | Rating | Detail |
|---------|--------|--------|
| API key in URL query | **HIGH RISK** | Pipedrive API key is passed as `?api_token=KEY` in every request. This appears in Pipedrive access logs, Railway logs, and any proxy logs. If Vercel's request logging captures query strings, the key is exposed there too. |
| No auth on webhook | **MEDIUM RISK** | `/webhook/fireflies` has no authentication. Anyone who knows the URL can inject fake meetingIds. They'd fail at `fetchTranscript()` but still consume resources. |
| Admin endpoints unprotected | **HIGH RISK** | `/api/admin/remove-reps`, `/api/admin/delete-scorecards`, `/api/admin/clear-skipped`, `/api/admin/backfill-recent` — all unprotected. Anyone can delete scorecard data. `/api/regrade-all` triggers a full rescore of everything. |
| Frontend direct DB access | **MEDIUM RISK** | Next.js server components use `neon(DATABASE_URL)` directly with full read/write access. If a SQL injection vector exists in any server component (unlikely with tagged templates, but possible), the entire DB is exposed. |
| CRON_SECRET auth | **GOOD** | Vercel poll route checks `Authorization: Bearer ${CRON_SECRET}`. |
| Health endpoint leaks config | **LOW** | `/health` exposes which API keys are set and a partial Slack token preview. Not critical but unnecessary. |
| SSL for Neon | **FAIR** | Connection uses `ssl: { rejectUnauthorized: false }` — accepts any certificate. Fine for Neon's internal network but not best practice. |

**Summary:** The Pipedrive API key in query strings is the most urgent fix. Admin endpoints need auth. The webhook endpoint should validate a shared secret.

---

## 3. Ranked Improvements

### #1 — Unify Scoring Prompts (Single Source of Truth)
**Impact:** Maintainability, correctness
**What's wrong:** The same scoring rubric, system prompt, and followup detection logic exist in 3 separate files across 2 languages. `src/scoring-engine.js` (376 lines), `web/src/lib/scoring-prompts.ts` (613 lines), and `poller.js` (embedded). Every prompt change must be replicated 3 times. They're already drifting — the SPICED labels differ between Railway and Vercel versions.
**Why it matters:** This is the #1 source of bugs and the #1 friction point for tuning the scoring system. When Kimi wants to adjust the close scoring rubric, it's a 20-minute change across 3 files instead of a 2-minute change in one.
**Fix:** Extract all prompts into a single shared module (`shared/scoring-prompts.js`) that both the Railway backend and Vercel frontend import. For poller.js, generate prompts dynamically from the same module rather than embedding them. Followup detection should move to a shared module too.
**Effort:** M — requires careful extraction, testing all 3 pipelines still produce identical prompts.

### #2 — Add Retry with Backoff to Scoring Pipeline
**Impact:** Reliability
**What's wrong:** If DeepSeek times out or returns garbage, the call is permanently lost. No retry, no dead letter queue. The webhook won't re-fire.
**Why it matters:** Current volume is ~5 demos/rep/day (~35 calls/day). At scale (~200 calls/day), even a 1% failure rate means 2 lost scorecards daily. Reps don't get feedback on their calls. Also: when DeepSeek has an outage, ALL calls during that window are lost.
**Fix:** Add a retry mechanism in `_processDemoInner`: 3 attempts with exponential backoff (2s, 8s, 30s). If all fail, insert into `pending_scores` table for the local poller to pick up. The local poller already processes `pending_scores` — this just needs the Railway pipeline to enqueue there on failure. Also add a `SIGNAL` timeout (not `AbortSignal.timeout`) so we can distinguish "API slow" from "API error."
**Effort:** S — mostly plumbing existing `pending_scores` table into the error path.

### #3 — Move Pipedrive API Key to Headers, Not Query Strings
**Impact:** Security
**What's wrong:** `?api_token=${PIPEDRIVE_API_KEY}` appears in every Pipedrive API call. This key is logged in Pipedrive access logs, potentially in Railway/Vercel request logs, and in any intermediate proxy.
**Why it matters:** The Pipedrive API key has full access to the SalesCloser deal pipeline. Exposure means an attacker can read, modify, or delete all deals. This is a credential leak vector.
**Fix:** Pipedrive supports header-based auth: `X-Api-Token: ${KEY}` or query param. Switch all calls to use the header instead. While at it, audit that API keys are never logged — add a `console.log` scrubber.
**Effort:** S — find-and-replace across 6-8 call sites. Test Pipedrive queries still work.

### #4 — Add Auth to Admin Endpoints
**Impact:** Security
**What's wrong:** `/api/admin/remove-reps`, `/api/admin/delete-scorecards`, `/api/admin/clear-skipped`, `/api/admin/backfill-recent` — all wide open. `/api/regrade-all` is unprotected and triggers a full-rescore of every call.
**Why it matters:** Anyone who discovers the Railway URL can delete all scorecard data or trigger a mass rescore that burns $50+ in API credits. The Railway URL is not secret (it's in the Vercel env as `RAILWAY_API_URL`).
**Fix:** Add a simple shared-secret middleware (same `CRON_SECRET` or a new `ADMIN_SECRET`). Check `Authorization: Bearer ${ADMIN_SECRET}` on all `/api/admin/*` and `/api/regrade-all`. Return 401 if missing/wrong.
**Effort:** S — 20 lines of middleware, apply to 5 routes.

### #5 — Split index.js Into Route Modules
**Impact:** Maintainability
**What's wrong:** `src/index.js` is 1771 lines. It contains the webhook handler, 15+ API routes, the full pipeline orchestration, progression stats computation, and debug endpoints — all in one file.
**Why it matters:** Every change to any route requires reading through unrelated code. It's impossible to test individual routes. The file has become a dumping ground.
**Fix:** Extract routes into `src/routes/`:
- `webhook.js` — `/webhook/fireflies` + `processDemo` pipeline
- `scoring.js` — `/score`, `/api/score-direct`, `/api/regrade-all`, `/api/backfill`
- `analytics.js` — `/api/progression-stats`, `/api/closed-call-examples`, `/api/rep-pipeline`
- `autopsy.js` — `/api/deal-autopsy`, `/api/team-autopsy`, `/api/autopsy-history`, `/api/autopsy/:id`
- `admin.js` — admin + debug endpoints
- `pipeline.js` — `processDemo`, `_processDemoInner`, `detectFollowup`, `resolveTeam`

`index.js` becomes ~50 lines of Express setup + route mounting.
**Effort:** M — large refactor but mechanical. No logic changes, just moving code. Risk: breaking route registration or import paths.

### #6 — Add Caching to Dashboard Queries
**Impact:** Performance, cost
**What's wrong:** Every dashboard page load runs fresh aggregations against the scorecards table and fetches live Pipedrive status for every linked deal. At 200 calls/day with 7 AEs, that's potentially 50+ Pipedrive API calls per page load.
**Why it matters:** As the team grows and call volume increases, dashboard pages will take 5-15 seconds to load. Pipedrive has rate limits. These are expensive page loads.
**Fix:** Three levels:
1. **DB-level caching:** Add materialized view for team stats (refreshed every 5 min by cron).
2. **API-level caching:** Add `Cache-Control: public, max-age=300` headers on stats endpoints. Use Vercel's built-in CDN cache.
3. **Pipedrive batch caching:** Store deal status snapshots in `scorecards` table (already partially done with `pipedrive_deal_stage`). Refresh stale ones (>1 hour) in background, not on page load.
**Effort:** M — materialized view + cache headers is quick. Background refresh requires a cron job.

### #7 — Add a Dead Letter Queue for Failed Scorings
**Impact:** Reliability
**What's wrong:** Current failure modes for a scoring attempt: DeepSeek timeout, DeepSeek garbage response, Fireflies transcript unavailable, DB write failure. In all cases, the call is logged and abandoned.
**Why it matters:** Without visibility into what's failing, the team doesn't know which calls were missed. James has no way to see "3 calls failed to score today."
**Fix:** Add a `scoring_attempts` table: `(meeting_id, attempt_number, status, error_message, created_at)`. Log every attempt (success or failure). Add a `/api/debug/failures` endpoint showing recent failures. Add a retry button in the admin UI. The existing `pipelineErrors` in-memory array is a start but doesn't persist across restarts.
**Effort:** S — new table + INSERT on each scoring path. Query endpoint.

### #8 — Eliminate Duplicate Transcript Fetching Logic
**Impact:** Maintainability, reliability
**What's wrong:** `fireflies-client.js` has `fetchTranscript()` and `buildTranscriptText()`. `poll/route.ts` has its own `fetchTranscript()` and inline transcript building. `deal-autopsy.js` has a THIRD implementation. Each has subtle differences in error handling and data normalization.
**Why it matters:** If Fireflies changes their API, we have to fix 3 different implementations. The Vercel poller's version doesn't handle comma-concatenated participant emails correctly (the Railway version does).
**Fix:** Create a shared `transcript-utils.js` module that all 3 consumers import. The module handles: Fireflies GraphQL call, sentence-to-text formatting, rep/company extraction from title, participant email parsing. One implementation, tested once.
**Effort:** M — refactoring across 3 consumers, careful testing needed.

### #9 — Reduce Prompt Token Bloat
**Impact:** Cost, scoring speed
**What's wrong:** Every scoring call sends:
- System prompt: ~2,000 words
- User prompt: ~3,000 words (full rubric) + ~8,000 words (transcript)
Total: ~13,000 words ≈ ~16,000 tokens per call. At 200 calls/day, ~3.2M tokens/day.
**Why it matters:** At DeepSeek pricing (~$0.27/M input tokens), that's ~$0.86/day just in rubric overhead. The rubric is static — it doesn't need to be sent in full every time. Also, larger prompts = slower responses.
**Fix:** Move the full rubric into the system prompt (which is cached by some providers). In the user prompt, only include: rep name, company, duration, and a 1-line reference: "Score against the standard SalesCloser rubric as described in the system prompt." This cuts the user prompt by ~60%. For team-specific weight overrides, send only the override JSON, not the entire rubric.
**Effort:** S — primarily prompt engineering. Test that scores don't shift with the shorter prompt.

### #10 — Add Input Validation on Webhook
**Impact:** Reliability, security
**What's wrong:** The webhook handler does: `const meetingId = req.body.meetingId || req.body.meeting_id || req.body.data?.meetingId`. No validation of the body shape, no check that meetingId is a string, no size limit on the request body.
**Why it matters:** Fireflies sometimes sends webhooks with unexpected payload shapes. A malformed webhook can crash the parser. Also: no body size limit means an attacker can send a 10MB payload and exhaust memory.
**Fix:** Add `express.json({ limit: '1mb' })`. Validate meetingId is a non-empty string matching Fireflies' expected format. Log and reject invalid payloads with 400. Add a shared secret header check (Fireflies doesn't support custom headers, but we can use a query param or just validate the payload shape).
**Effort:** S — 15 lines of validation.

---

## 4. Quick Wins (Under 1 Hour Each)

These don't need their own section but are worth doing:

1. **Remove health endpoint token preview** — `/health` leaks `SLACK_BOT_TOKEN` prefix. Remove `slack_token_preview` field.
2. **Fix hardcoded team IDs** — Move `1f7fb17c-...` to an env var or query from DB in all 3 locations.
3. **Add `pool.on('error')` handler** — `db.js` creates a pg Pool but doesn't listen for idle client errors. A disconnected client can crash the process.
4. **Fix `rejectUnauthorized: false`** — Use Neon's proper CA cert or at minimum set `rejectUnauthorized: true` with the correct CA.
5. **Add request logging middleware** — Log method, path, status, and duration for every request. Currently only manual `console.log` calls.

---

## 5. Architecture Decision Records (Proposed)

### ADR-1: Single Scoring Pipeline
**Decision:** Consolidate to a single scoring path. All calls (webhook or poll-discovered) flow through the Railway `/webhook/fireflies` → `processDemo()` pipeline. The Vercel poller discovers new calls and POSTs them to the Railway webhook endpoint instead of scoring independently.
**Rationale:** Eliminates duplicate logic, ensures consistent behavior, gives us one place to add retry/queuing/monitoring.

### ADR-2: Prompt Module as Shared Package
**Decision:** Extract `scoring-prompts` into a shared npm package or git submodule used by both `src/` and `web/`.
**Rationale:** Single source of truth for all prompts. TypeScript support for both consumers. Version-tagged so we can roll back prompt changes independently of app deploys.

### ADR-3: API Gateway Between Frontend and DB
**Decision:** Next.js server components should call the Railway API for data, not query Neon directly.
**Rationale:** Single DB access layer, ability to add caching/auth/rate-limiting in one place, easier to audit queries. This is a V2 concern but should be the target architecture.

---

## 6. Summary

The system works. Calls flow from Fireflies → scored → Slack → dashboard. The core pipeline is sound. The problems are all in the seams:

- **Duplicate code** is the biggest drag on development velocity
- **No retry** means silent data loss during API blips
- **Credential leakage** is an accident waiting to happen
- **Monolithic routing** makes the codebase harder to extend each sprint

The top 3 fixes (unified prompts, retry logic, Pipedrive auth) would eliminate ~80% of the operational risk and maintenance friction. Combined effort: ~2-3 days of focused work.
