// ─── Scoring Prompts (TypeScript re-export) ──────────────────────
// All prompts are sourced from shared/scoring-prompts.js (single source of truth).
// This file exists for backward compatibility with existing TypeScript imports.

import sharedPrompts from "../../../shared/scoring-prompts";

export const SCORING_SYSTEM_PROMPT: string = sharedPrompts.SCORING_SYSTEM_PROMPT;
export const FOLLOWUP_SYSTEM_PROMPT: string = sharedPrompts.FOLLOWUP_SYSTEM_PROMPT;

export const DEFAULT_WEIGHTS: {
  preCall: number;
  discovery: number;
  presentation: number;
  pricing: number;
  closing: number;
} = sharedPrompts.DEFAULT_WEIGHTS;

export interface Weights {
  preCall: number;
  discovery: number;
  presentation: number;
  pricing: number;
  closing: number;
}

export const buildScoringPrompt: (
  transcriptText: string,
  repName: string,
  companyName: string,
  durationMinutes: number | null
) => string = sharedPrompts.buildScoringPrompt;

export const buildFollowupScoringPrompt: (
  transcriptText: string,
  repName: string,
  companyName: string,
  durationMinutes: number | null,
  priorCallContext: string | null
) => string = sharedPrompts.buildFollowupScoringPrompt;

export const buildScoringPromptWithWeights: (
  transcriptText: string,
  repName: string,
  companyName: string,
  durationMinutes: number | null,
  weights?: Weights
) => string = sharedPrompts.buildScoringPromptWithWeights;
