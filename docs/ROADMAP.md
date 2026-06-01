# Killer Calls: 100x Roadmap

## North Star
Killer Calls evolves from a post-call scoring tool into a revenue operating system that SalesCloser runs on AND sells. Target: $50K+ MRR from productized version within 18 months.

## Phases & Goals

---

### PHASE 1: Pipeline Brain (Months 1-3)
*"Stop scoring calls in isolation. Connect every call to a deal, a stage, and an outcome."*

**Goal 1.1 — Deal-stage scoring correlation**
- What: Every scorecard linked to Pipedrive deal + stage. Dashboard shows avg score by stage, by rep, by outcome.
- Success: James can answer "where in the pipeline are deals dying?" with a single query, segmented by rep and tier.
- Depends on: Pipedrive webhook or poller for deal stage changes, deal-stage field in scorecards table (partially done).

**Goal 1.2 — Per-deal win probability**
- What: Each active deal gets a live probability score based on: call scores, U-step pain capture quality, DM presence, pricing vs segment average, rep historical close rate.
- Success: James can sort pipeline by win probability and see the top 3 factors dragging each deal down.
- Depends on: 1.1, historical won/lost deal data (we have ~6 months), a simple model (even weighted heuristic before ML).

**Goal 1.3 — Rep trajectory dashboard**
- What: Weekly trend lines per rep on: overall score, U-step score, close attempt rate, talk ratio. Flag declining trends before they hit close rate.
- Success: System auto-alerts when a rep's U-step drops 2+ weeks in a row. James sees it before he feels it.
- Depends on: 1.1, weekly scoring cadence (already running).

**Goal 1.4 — Stall detection**
- What: Alert when a deal sits in the same stage >X days with call scores below threshold. "This deal is stalling, and here's why."
- Success: 2-3 stalling deals caught and rescued per month that would have been lost.
- Depends on: 1.1, 1.2.

---

### PHASE 2: Live Coach Alpha (Months 4-6)
*"Coach reps DURING the call, not after."*

**Goal 2.1 — Real-time transcription pipeline**
- What: Streaming audio → near-instant transcription → LLM inference loop. Sub-5-second latency from prospect speech to rep nudge.
- Success: Test bench processes a live call and produces contextual nudges with <5s latency.
- Depends on: Fireflies streaming API (or alternative: Deepgram, AssemblyAI, Gladia), WebSocket infrastructure.

**Goal 2.2 — Nudge engine**
- What: Rule-based + LLM prompts that detect: monologue (talk ratio alert), missed U-step (no pain question in 5+ min), objection detection (trigger ECIR prompt), close opportunity (trigger 123 prompt), over-pricing flag.
- Success: 10+ nudge types, each triggering with >80% precision (not false-alarming the rep mid-call).
- Depends on: 2.1, rubric definitions from current scoring engine.

**Goal 2.3 — Private delivery channel**
- What: Rep receives nudges via Telegram DM or Slack sidebar. Only the rep sees them. No prospect-facing UI.
- Success: 1-2 alpha reps using live coach on real calls. Qualitative feedback: "Did it help you close?"
- Depends on: 2.1, 2.2.

**Goal 2.4 — Alpha results measurement**
- What: Compare close rate, U-step scores, and objection handling scores for alpha reps before vs during live coach.
- Success: Statistically meaningful improvement on at least 2 of 3 metrics. If not, tune or pivot.
- Depends on: 2.3, Phase 1 scoring infrastructure.

---

### PHASE 3: Automated Coaching (Months 7-9)
*"The system assigns the coaching, not James."*

**Goal 3.1 — Weakness detection per rep**
- What: Each rep gets a persistent "skill profile" updated weekly: strongest phase, weakest phase, specific sub-skills trending up/down.
- Success: Every rep has a living profile that accurately predicts which phase they'll lose points in.
- Depends on: Phase 1 scoring data, 3+ months of score history per rep.

**Goal 3.2 — Exemplar matching engine**
- What: When a rep is weak in U-step, system searches the Killer Calls library for the best U-step call from a peer (not the same rep), extracts the relevant timestamps, and packages it as an assignment.
- Success: Rep receives "watch this" assignment within 24 hours of a weak call being scored.
- Depends on: 3.1, call library with timestamped phase segments, vector embeddings for semantic search.

**Goal 3.3 — Assignment + completion tracking**
- What: System assigns micro-learning (watch clip, record Loom, practice script), tracks completion, re-scores next week's calls to measure improvement.
- Success: James's coaching ops time drops from hours/week to <30 min/week. Assignment completion rate >80%.
- Depends on: 3.2.

**Goal 3.4 — Escalation rules**
- What: If a rep's assigned skill doesn't improve after 2 coaching cycles, auto-escalate to James with a specific recommendation (paired call, role-play, PIP review).
- Success: No rep declines for 4+ weeks without James being explicitly alerted with evidence.
- Depends on: 3.3, Phase 1 trajectory data.

---

### PHASE 4: Voice of Customer (Months 8-10)
*"Every call is market research. Mine it."*

**Goal 4.1 — Objection taxonomy**
- What: Auto-categorize every objection across all calls. Track frequency by rep, by segment, by week. Surface rising trends.
- Success: Weekly "Objection Report" in Slack: top 3 objections, trend direction, which reps handle them best.
- Depends on: Scoring engine already captures objections (ECIR section). Needs aggregation layer.

**Goal 4.2 — Competitive intelligence**
- What: Detect competitor mentions, track frequency over time, link to deal outcomes.
- Success: "Competitor X appeared in 22% of lost deals this month, up from 14%. Here are the calls. Here's how reps who beat them responded."
- Depends on: 4.1, named entity extraction from transcripts.

**Goal 4.3 — Segment intelligence**
- What: Surface behavioral differences by segment. "LATAM prospects ask about pricing 2x earlier than US." "UK prospects mention compliance 3x more."
- Success: James can make segment-specific coaching and positioning decisions backed by call data, not intuition.
- Depends on: 4.1, deal-segment tagging from Pipedrive.

---

### PHASE 5: Productization (Months 10-12)
*"What if we sold it?"*

**Goal 5.1 — Multi-tenant architecture**
- What: Separate orgs, separate data, separate Slack workspaces. One Killer Calls instance serving multiple sales teams.
- Success: SalesCloser team + 1 beta customer (wishpond/PIQ/Invigo) running on the same infrastructure with isolated data.
- Depends on: Auth layer, tenant isolation in DB, per-tenant API keys for Fireflies/Pipedrive.

**Goal 5.2 — Self-serve onboarding**
- What: New customer connects Fireflies + Pipedrive, system auto-imports historical calls, scores them, delivers first insights within 24 hours.
- Success: A new customer can go from signup to "first actionable insight" without talking to a human.
- Depends on: 5.1, OAuth flows for Fireflies and Pipedrive.

**Goal 5.3 — Pricing + packaging**
- What: Per-rep pricing ($50-150/mo), tiered by feature set (Basic: scoring + pipeline brain, Pro: live coach + automated coaching, Enterprise: white-label + VOC mining).
- Success: Pricing model that scales with customer size. Clear upsell path from Basic → Pro.
- Depends on: 5.1, feature gating.

**Goal 5.4 — First 3 paying customers**
- What: 3 external sales teams paying for Killer Calls. Target: $3K-10K MRR combined.
- Success: Paying customers with measurable close rate improvement. At least 1 case study.
- Depends on: 5.1, 5.2, 5.3.

---

## What's Actionable Right Now

**This week, without any new infrastructure:**

| # | Action | Time | Phase |
|---|--------|------|-------|
| 1 | Complete Pipedrive deal-stage tracking in scorecards table (backfill existing) | ~2 hrs dev | P1 |
| 2 | Build a simple "scores by deal stage" query + Slack command | ~2 hrs dev | P1 |
| 3 | Wire the weekly coaching digest (already exists) to include deal-stage context | ~1 hr dev | P1 |
| 4 | Run a correlation analysis: U-step scores vs won/lost outcomes (we have the data) | ~30 min query | P1 |

**This month:**

| # | Action | Phase |
|---|--------|-------|
| 1 | Rep trajectory dashboard (web frontend, 3 trend lines per rep) | P1 |
| 2 | Per-deal win probability MVP (weighted heuristic, not ML) | P1 |
| 3 | Evaluate real-time transcription providers (Deepgram, Gladia, AssemblyAI) | P2 |
| 4 | Objection taxonomy V1 from existing ECIR data | P4 |

---

## Success Metrics (12-Month)

| Metric | Current | Target |
|--------|---------|--------|
| Time from call end → scorecard in Slack | ~2 min | <1 min (current), real-time (Phase 2) |
| Coaching ops time (James) | ~3-5 hrs/week | <30 min/week |
| Rep close rate improvement from coaching | Unmeasured | +15% for reps on automated coaching loop |
| Deals rescued via stall detection | 0/month | 2-3/month |
| Killer Calls external MRR | $0 | $3-10K (3 customers) |
| SalesCloser internal ROI | Tool cost only | Paid for by retained MRR from rescued deals |
