import { getDb } from "./db";

export interface AeRosterEntry {
  name: string;
  email: string;
  slackId: string;
}

export interface RagThresholds {
  green: number;
  yellow: number;
}

export interface ScoringWeights {
  preCall: number;
  discovery: number;
  presentation: number;
  pricing: number;
  closing: number;
}

export interface TeamGoals {
  targetAvgScore: number;
  targetGreenPct: number;
}

export interface SettingsMap {
  ae_roster: AeRosterEntry[];
  rag_thresholds: RagThresholds;
  min_call_duration: number;
  claude_model: string;
  slack_channel_reviews: string;
  slack_channel_killer: string;
  app_url: string;
  fireflies_api_key: string;
  slack_bot_token: string;
  killer_threshold: number;
  excluded_patterns: string[];
  scoring_weights: ScoringWeights;
  team_goals: TeamGoals;
}

export type SettingsKey = keyof SettingsMap;

export async function getAllSettings(teamId: string): Promise<Record<string, unknown>> {
  const sql = getDb();
  const rows = await sql`SELECT key, value FROM settings WHERE team_id = ${teamId} ORDER BY key`;
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.key as string] = row.value;
  }
  return map;
}

export async function getSetting<K extends SettingsKey>(teamId: string, key: K): Promise<SettingsMap[K] | null> {
  const sql = getDb();
  const rows = await sql`SELECT value FROM settings WHERE team_id = ${teamId} AND key = ${key} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0].value as SettingsMap[K];
}
