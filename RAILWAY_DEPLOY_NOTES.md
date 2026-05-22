# Railway Deployment Notes — Scoring Backend

## Environment Variables to Set

### For OpenClaw backend (when Railway can reach local Gateway):
- `SCORING_BACKEND=openclaw` (requires Gateway to be accessible)

### For Anthropic backend (cloud-only, needs valid key):
- `SCORING_BACKEND=anthropic`
- `ANTHROPIC_API_KEY=<valid-key>`

### For deferred backend (cloud + local poller combo):
- `SCORING_BACKEND=deferred`
- Local poller processes `pending_scores` table entries

### New endpoint: POST /score
Body: { meetingId, transcriptText, repName, companyName, durationMinutes, systemPrompt?, userPrompt?, callType?, priorCallContext? }
Returns: { status: "ok", scorecard: {...} } or { status: "deferred" }

### Vercel env vars needed:
- `RAILWAY_API_URL` — Railway API base URL (default: https://killer-calls-api-production.up.railway.app)
- Remove `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` (no longer needed)
