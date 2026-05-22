ALTER TABLE scorecards ADD COLUMN IF NOT EXISTS pipedrive_deal_id VARCHAR(50);
ALTER TABLE scorecards ADD COLUMN IF NOT EXISTS pipedrive_deal_stage VARCHAR(100);
ALTER TABLE scorecards ADD COLUMN IF NOT EXISTS pipedrive_deal_value NUMERIC(12,2);
