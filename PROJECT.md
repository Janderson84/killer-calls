# Killer Calls

AI-powered demo review system that automatically scores sales calls and delivers actionable coaching feedback to reps.

## Vision

Prove internally that automated call scoring improves sales team performance, then productize and sell to other teams.

## Users

- **Sales reps** (~9 now, ~40 soon) — self-coaching via scorecards after every demo
- **Sales managers** (V2) — dashboards for identifying coaching points and trends
- **Scale:** ~5 demos/rep/day, ~200 calls/day at full adoption

## How It Works

1. Rep completes a demo call recorded by Fireflies.ai
2. Fireflies webhook triggers the pipeline
3. Transcript is fetched via Fireflies GraphQL API
4. Claude scores the call against a 14-criterion, 100-point rubric
5. Scorecard is persisted to Supabase
6. Slack notification is posted with a link to the full coaching detail page
7. Rep clicks through to review scores, timestamps, and coaching notes

## Scoring Rubric (100 points)

| Phase | Points | Key Criteria |
|-------|--------|-------------|
| Pre-Call Preparation | 6 | Research & preparation |
| Discovery | 32 | Agenda setting, SPICED (Situation, Pain, Impact, Critical Event, Decision) |
| Presentation | 22 | Smoothness, talk ratio, personalization, tie-downs |
| Pricing & Objection Handling | 28 | Value summary, simple pricing, no premature discount, ECIR framework |
| Close & Next Steps | 12 | Push to close, scheduled follow-up |

Bonus flags: enthusiasm, unprofessional language, premature disqualification.

## Tech Stack

- **Backend:** Node.js / Express (webhook + pipeline)
- **Scoring engine:** Claude (Anthropic API)
- **Transcript source:** Fireflies.ai (GraphQL API)
- **Database:** Supabase (Postgres)
- **Frontend:** Next.js (standalone app)
- **Notifications:** Slack (Block Kit messages)
- **Deployment:** Vercel (planned)

## Current State (MVP)

Working pipeline: Fireflies webhook → Claude scoring → Slack posts. Scorecards are not persisted. No web UI. Reps see scores only via Slack messages in #demo-reviews and #killer-calls (80+ scores).

## Roadmap

### V1 — Self-Coaching for Reps
1. **Supabase persistence** — schema + store every scorecard from the pipeline
2. **Call detail page** — Next.js page with full scorecard, SPICED/ECIR breakdowns, timestamps, coaching notes
3. **Slack deep links** — Slack notifications link directly to the call detail page
4. **Rep scorecard history** — rep can see all their past calls and scores

### V2 — Manager Dashboards
- Manager dashboard with team-level views
- Trend tracking (rep improvement over time)
- Coaching point identification
- Leaderboard
- Hall of fame for top calls

### V3 — Productization
- Multi-tenant support
- Onboarding flow
- Billing
- Custom rubrics per team

## Project Structure

```
killer-calls/
  src/
    index.js              # Express server, webhook endpoint, pipeline orchestration
    constants.js          # Scoring rubric, RAG thresholds, config
    fireflies-client.js   # Fireflies GraphQL client, transcript fetching
    scoring-engine.js     # Claude scoring prompt + JSON parsing
    slack-formatter.js    # Slack Block Kit message builder + posting
  test-webhook.js         # Local webhook testing utility
  *.html                  # UI mockups (call detail, leaderboard, hall of fame, slack)
  demo_review_system.docx # Original spec/planning doc
```

## Slack Channels

- **#demo-reviews** — every scored call
- **#killer-calls** — only 80+ scores (celebratory)
