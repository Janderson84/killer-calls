-- pending_scores table: stores calls that need scoring by the local poller
-- Used when SCORING_BACKEND=deferred (cloud deployments that can't reach OpenClaw)
CREATE TABLE IF NOT EXISTS pending_scores (
  id SERIAL PRIMARY KEY,
  meeting_id VARCHAR(255) UNIQUE NOT NULL,
  rep_name VARCHAR(255),
  company_name VARCHAR(255),
  duration_minutes INTEGER,
  system_prompt TEXT,
  user_prompt TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_scores_status ON pending_scores(status);
CREATE INDEX IF NOT EXISTS idx_pending_scores_meeting_id ON pending_scores(meeting_id);
