-- autopsies table: stores won-deal autopsy analysis results
-- Linked to reps, retrievable by rep slug or deal ID

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
);

CREATE INDEX IF NOT EXISTS idx_autopsies_rep_name ON autopsies(rep_name);
CREATE INDEX IF NOT EXISTS idx_autopsies_deal_id ON autopsies(deal_id);
CREATE INDEX IF NOT EXISTS idx_autopsies_generated_at ON autopsies(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopsies_status ON autopsies(status);
