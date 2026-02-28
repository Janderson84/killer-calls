// ─── Scoring Rubric ───────────────────────────────────────────────
// 14 criteria, 100 points total, grouped into 5 call phases.

const RUBRIC = {
  phases: [
    {
      id: "preCall",
      name: "Pre-Call Preparation",
      maxPoints: 6,
      criteria: [
        {
          id: "research",
          name: "AE demonstrated research and preparation",
          maxPoints: 6,
          ragGuide: {
            green: "Industry/role knowledge evident, referenced specific details about the prospect",
            yellow: "Some research but surface-level — company name and basic info only",
            red: "No evidence of preparation, generic opening"
          }
        }
      ]
    },
    {
      id: "discovery",
      name: "Discovery",
      maxPoints: 32,
      criteria: [
        {
          id: "agenda",
          name: "Set a proper agenda at call open",
          maxPoints: 7,
          ragGuide: {
            green: "Agenda set AND prospect agreed/confirmed",
            yellow: "Agenda stated but no buy-in from prospect",
            red: "No agenda set"
          }
        },
        {
          id: "spiced",
          name: "SPICED discovery (all 5 elements)",
          maxPoints: 25,
          isSpiced: true,
          elements: {
            s: { name: "Situation", maxPoints: 5, question: "What is the prospect's current setup, team size, and context?" },
            p: { name: "Pain", maxPoints: 5, question: "Did the AE uncover a specific, named business problem?" },
            i: { name: "Impact", maxPoints: 5, question: "Did the AE quantify what the pain costs the business?" },
            c: { name: "Critical Event", maxPoints: 5, question: "Is there a deadline or event that makes solving this urgent?" },
            e: { name: "Decision", maxPoints: 5, question: "Did the AE map the decision process, timeline, and stakeholders?" }
          }
        }
      ]
    },
    {
      id: "presentation",
      name: "Presentation",
      maxPoints: 22,
      criteria: [
        {
          id: "smooth",
          name: "Presentation was smooth and professional",
          maxPoints: 4,
          ragGuide: {
            green: "Fluid, no awkward gaps or filler phrases",
            yellow: "Minor stumbles but recovered well",
            red: "Repetitive, jargon-heavy, or disjointed"
          }
        },
        {
          id: "talkRatio",
          name: "AE avoided long monologues (talk ratio)",
          maxPoints: 6,
          ragGuide: {
            green: "No unbroken stretch >90 seconds, prospect spoke ~40%",
            yellow: "One or two long stretches, but mostly interactive",
            red: "Multiple 3+ min monologues without check-ins"
          }
        },
        {
          id: "personalization",
          name: "Presentation was personalized to the prospect",
          maxPoints: 8,
          ragGuide: {
            green: "Specific examples tied to prospect's stated pain",
            yellow: "Some personalization but mostly generic walkthrough",
            red: "Pure feature dump, no connection to prospect's situation"
          }
        },
        {
          id: "tieDowns",
          name: "AE used tie-downs to close as they go",
          maxPoints: 4,
          ragGuide: {
            green: "Regular value checks at each section",
            yellow: "Occasional check-ins but inconsistent",
            red: "No pauses for agreement or reaction"
          }
        }
      ]
    },
    {
      id: "pricing",
      name: "Pricing & Objection Handling",
      maxPoints: 28,
      criteria: [
        {
          id: "valueSummary",
          name: "Provided value summary before stating price",
          maxPoints: 8,
          ragGuide: {
            green: "Full recap of benefits before price reveal",
            yellow: "Brief mention of value but not a full summary",
            red: "Price dropped without context"
          }
        },
        {
          id: "simplePricing",
          name: "Discussed pricing simply with one option first",
          maxPoints: 6,
          ragGuide: {
            green: "One option, waited for response, held silence",
            yellow: "One option but jumped in to fill silence",
            red: "Multiple options presented simultaneously or confusing pricing"
          }
        },
        {
          id: "noDiscount",
          name: "Did NOT cave on discount/terms prematurely",
          maxPoints: 2,
          ragGuide: {
            green: "No discount offered, or only after full ECIR",
            red: "Discount offered before objection fully explored — auto-red flag"
          }
        },
        {
          id: "ecir",
          name: "ECIR objection handling",
          maxPoints: 12,
          ragGuide: {
            green: "Full ECIR (Empathize → Clarify → Isolate → Respond) on all objections",
            yellow: "Partial ECIR — missed one or two steps",
            red: "Jumped straight to discount/defense without ECIR"
          },
          ecirSteps: {
            e: { name: "Empathize", question: "Did the AE genuinely acknowledge the concern before defending?" },
            c: { name: "Clarify", question: "Did the AE ask a question to fully understand the objection?" },
            i: { name: "Isolate", question: "Did the AE confirm this was the only/real concern?" },
            r: { name: "Respond", question: "Did the AE answer the objection directly rather than deflecting?" }
          }
        }
      ]
    },
    {
      id: "closing",
      name: "Close & Next Steps",
      maxPoints: 12,
      criteria: [
        {
          id: "svc",
          name: "SVC Close (Summarize → Surface Concern → Commit)",
          maxPoints: 10,
          isSvc: true,
          elements: {
            summarize: {
              name: "Summarize Value",
              maxPoints: 4,
              question: "Did the AE recap 2-3 specific benefits tied to the prospect's stated pain BEFORE asking for the close? This is NOT a feature recap — it must reference what the prospect said they cared about during discovery."
            },
            surface: {
              name: "Surface Concern",
              maxPoints: 3,
              question: "Did the AE proactively ask 'What would stop you from moving forward today?' or similar — giving the prospect a chance to voice remaining hesitation BEFORE the commitment ask?"
            },
            commit: {
              name: "Commit",
              maxPoints: 3,
              question: "Did the AE make a clear, direct ask for a commitment (sign today, start a trial, schedule an onboarding call) — not just 'what do you think?' or 'I'll send a proposal'?"
            }
          },
          ragGuide: {
            green: "All three SVC steps executed in order — value summarized, concerns surfaced, commitment asked",
            yellow: "Attempted to close but skipped the value summary or didn't surface concerns first",
            red: "No real close attempt — defaulted to 'I'll send a follow-up email'"
          }
        },
        {
          id: "followUp",
          name: "Scheduled a specific follow-up date and time",
          maxPoints: 2,
          ragGuide: {
            green: "Specific date/time confirmed on the call",
            yellow: "General timeframe discussed but not locked in",
            red: "Vague 'I'll send a follow-up email'"
          }
        }
      ]
    }
  ],

  bant: {
    id: "bant",
    name: "BANT Qualification",
    elements: {
      b: { name: "Budget", question: "Did the AE establish whether the prospect has budget allocated or can secure it?" },
      a: { name: "Authority", question: "Did the AE confirm who the decision-maker is and whether they're on the call?" },
      n: { name: "Need", question: "Did the AE uncover a clear, urgent business need that the product solves?" },
      t: { name: "Timeline", question: "Did the AE establish a concrete timeline or deadline for making a decision?" }
    }
  },

  bonusFlags: [
    { id: "enthusiasm", name: "Enthusiasm and energy", description: "Was energy consistently high and genuine?" },
    { id: "unprofessionalLanguage", name: "Unprofessional language", description: "Any slang, filler words, cringeworthy phrasing?" },
    { id: "prematureDisqualification", name: "Premature disqualification", description: "Did the AE rule out this prospect too early?" }
  ]
};

// ─── RAG Thresholds ──────────────────────────────────────────────

const RAG = {
  green: { min: 80, label: "Green", emoji: "🟢" },
  yellow: { min: 60, label: "Yellow", emoji: "🟡" },
  red: { min: 0, label: "Red", emoji: "🔴" }
};

function getRAG(score) {
  if (score >= RAG.green.min) return RAG.green;
  if (score >= RAG.yellow.min) return RAG.yellow;
  return RAG.red;
}

// ─── Config ──────────────────────────────────────────────────────

const CONFIG = {
  port: process.env.PORT || 3000,
  // Override via CLAUDE_MODEL env var in Railway/Vercel to pin a specific snapshot.
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-6-20250514",
  firefliesEndpoint: "https://api.fireflies.ai/graphql"
};

module.exports = { RUBRIC, RAG, getRAG, CONFIG };
