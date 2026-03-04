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
          id: "closeExecution",
          name: "Close execution (any style)",
          maxPoints: 10,
          isClose: true,
          // Claude picks the style that best matches what the rep did.
          // All three styles use the same 4+3+3 = 10 point structure.
          styles: {
            consultative: {
              name: "Consultative Close",
              description: "Best when discovery was thorough and the prospect needs value re-anchored before committing.",
              steps: {
                setup: {
                  name: "Summarize Value",
                  maxPoints: 4,
                  question: "Did the AE recap 2-3 specific benefits tied to the prospect's stated pain BEFORE asking for the close? Must reference what the prospect said during discovery — not a generic feature recap."
                },
                bridge: {
                  name: "Surface Blockers",
                  maxPoints: 3,
                  question: "Did the AE proactively ask 'What would stop you from moving forward?' or similar — surfacing remaining hesitation BEFORE the commitment ask?"
                },
                ask: {
                  name: "Ask for Commitment",
                  maxPoints: 3,
                  question: "Did the AE make a clear, direct ask? 'Can we get you started on the annual plan today?' counts. 'I'll send a proposal' does NOT."
                }
              }
            },
            assumptive: {
              name: "Assumptive Close",
              description: "Best when buying signals are strong throughout the call. The rep skips 'should we?' and goes straight to 'here's how we start.'",
              steps: {
                setup: {
                  name: "Read Buying Signals",
                  maxPoints: 4,
                  question: "Were there clear buying signals (prospect asking about implementation, pricing details, timelines) that justified skipping the traditional value recap? If the AE assumed the close without signals, this is a 0."
                },
                bridge: {
                  name: "Smooth Transition",
                  maxPoints: 3,
                  question: "Did the AE transition naturally from demo into next steps without an awkward shift? The move from 'showing' to 'doing' should feel effortless."
                },
                ask: {
                  name: "Lock Specific Action",
                  maxPoints: 3,
                  question: "Did the AE lock in a specific next action — not just 'let's get started' but 'I'll send the contract today, can you sign by Thursday?' Vague enthusiasm without a locked action is partial credit."
                }
              }
            },
            urgency: {
              name: "Urgency Close",
              description: "Best when a real critical event or deadline exists. Ties the commitment to a time-bound reason uncovered in discovery.",
              steps: {
                setup: {
                  name: "Tie to Critical Event",
                  maxPoints: 4,
                  question: "Did the AE reference a specific deadline, event, or business trigger that the PROSPECT mentioned during discovery? Manufactured urgency ('this price expires Friday') without a real business driver is a 0."
                },
                bridge: {
                  name: "Build the Timeline",
                  maxPoints: 3,
                  question: "Did the AE work backwards from the critical event to show why starting now is necessary? ('If you need this live by Q3, we need to kick off onboarding by mid-April.')"
                },
                ask: {
                  name: "Propose the Plan",
                  maxPoints: 3,
                  question: "Did the AE propose a concrete timeline with specific dates and milestones — not just 'we should move fast' but 'here's the plan to hit your deadline'?"
                }
              }
            }
          },
          ragGuide: {
            green: "All three steps of the chosen closing style executed well — setup, bridge, and ask",
            yellow: "Attempted to close but skipped the setup or bridge step",
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
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  firefliesEndpoint: "https://api.fireflies.ai/graphql"
};

module.exports = { RUBRIC, RAG, getRAG, CONFIG };
