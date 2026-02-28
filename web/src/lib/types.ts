export interface SpicedElement {
  score: number;
  status: "strong" | "partial" | "missing";
  feedback: string;
  timestamps: string[];
}

export interface BantElement {
  score: number;
  status: "strong" | "partial" | "missing";
  feedback: string;
  timestamps: string[];
}

export interface SvcElement {
  score: number;
  status: "strong" | "partial" | "missing";
  feedback: string;
  timestamps: string[];
}

export interface CriterionScore {
  score: number;
  maxPoints: number;
  rag: "g" | "y" | "r";
  feedback: string;
  timestamps: string[];
  objectionsHandled?: number;
  objections?: {
    topic: string;
    timestamp: string;
    empathize: boolean;
    clarify: boolean;
    isolate: boolean;
    respond: boolean;
  }[];
}

export interface PhaseScore {
  score: number;
  maxPoints: number;
  criteria: Record<string, CriterionScore>;
}

export interface Flag {
  detected: boolean;
  note: string;
}

export interface Scorecard {
  score: number;
  rag: "green" | "yellow" | "red";
  verdict: string;
  phases: {
    preCall: PhaseScore;
    discovery: PhaseScore;
    presentation: PhaseScore;
    pricing: PhaseScore;
    closing: PhaseScore;
  };
  spiced: {
    s: SpicedElement;
    p: SpicedElement;
    i: SpicedElement;
    c: SpicedElement;
    e: SpicedElement;
  };
  bant?: {
    b: BantElement;
    a: BantElement;
    n: BantElement;
    t: BantElement;
  };
  svc?: {
    summarize: SvcElement;
    surface: SvcElement;
    commit: SvcElement;
  };
  wins: string[];
  fixes: string[];
  flags: {
    enthusiasm: Flag;
    unprofessionalLanguage: Flag;
    prematureDisqualification: Flag;
  };
  quoteOfTheCall: {
    text: string;
    timestamp: string;
    context: string;
  };
}

export interface ScorecardRow {
  id: string;
  rep_id: string;
  meeting_id: string;
  title: string;
  company_name: string;
  rep_name: string;
  call_date: string;
  duration_minutes: number;
  score: number;
  rag: string;
  verdict: string;
  score_pre_call: number;
  score_discovery: number;
  score_presentation: number;
  score_pricing: number;
  score_closing: number;
  spiced_s: string;
  spiced_p: string;
  spiced_i: string;
  spiced_c: string;
  spiced_e: string;
  bant_b: string;
  bant_a: string;
  bant_n: string;
  bant_t: string;
  scorecard_json: Scorecard;
  created_at: string;
}
