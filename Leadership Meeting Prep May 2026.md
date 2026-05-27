# Leadership Meeting Prep
## May 2026 — James Anderson, Sales Manager

**Attendees:** CEO (Allie), CTO, Head of Customer Support, HR

---

## Status Updates — What I'm Working On

### 1. Sales Team Turnaround (Active)
Team is at ~$15K won across 7 AEs over ~5 months. Target is $35K MRR. We're underperforming and need to build out.

**What's happening:**
- Repositioned the demo framework from SPICED+BANT to QUICK — simpler, faster, 5 elements instead of 9. Deployed across all AEs this week.
- Built the Killer Calls scoring engine to grade every demo against the new framework. 636 calls regraded. Close is now weighted highest (22 pts).
- Created a one-sheet of tips from our three best closers ever (James Anderson, Marc Bowring, Bob Oshidary) backed by transcript analysis. Sharing with AEs this week.
- Analyzing what made James Anderson — our former top closer — successful: 53 demos analyzed, 33.5 hours of calls. Key findings: rapport-first, close-everywhere (5.7 per call), demo-as-discovery, 4-day median close velocity.
- Hiring 2-3 senior AEs to replace departed Zach and Marysol + expand capacity.

**Individual AE status (can share if asked):**
- Vanessa: Confidence crisis. Rebuilding momentum. Not on PIP.
- Edgar: 18 months, never hit quota. Verbal documentation only. Needs written PIP. Considering termination recommendation.
- Pedro: 2.6% win rate, 5 months in. Close to PIP territory.
- Alfred: Hit-or-miss, consistency issue. Young family.
- MJB: Solid, consistent.
- Gleidson: Mid-range.
- David: Mid-range. Talk ratio scores unreliable (Fireflies diarization error).

### 2. AI & Automation (Deployed)
- Killer Calls is live: api.killer-calls-api-production.up.railway.app + web-sage-pi-82.vercel.app
- DeepSeek-native scoring engine. QUICK framework. Auto-scores every demo.
- Built deal-autopsy engine for won-deal analysis.
- Regrade endpoint operational — can re-score entire database when rubric changes.
- Transcript analysis pipeline: Fireflies API → scoring → pattern extraction. Proved we can pull and analyze any AE's demo library.

### 3. Report Card Automation (Needs Fix — 3 known bugs)
- Weekly + rolling 30-day report card feeds Google Sheets.
- **Bug 1:** Demo count inflated ~25% (counts stage transitions, not actual demos). Fix: switch to activity-based counting.
- **Bug 2:** Pipeline health thresholds are useless (everyone is red, no differentiation). Fix: rescale to 80/120 thresholds or ratio-based.
- **Bug 3:** Pipeline stage IDs may be stale after James's recent stage changes. Needs verification.

### 4. AE Coaching & Enablement
- New one-sheet playbook distributing this week.
- QUICK framework training needed — mandate 5 recorded demos per AE, score on QUICK completion.
- Close role-play Fridays proposal: 30 min weekly, rotate through 6 closing methods.
- 48-hour pricing rule proposal: after every demo, pricing goes out within 48 hours.

---

## Conversation Topics — Things to Raise

### With CEO (Allie)

**1. Sales turnaround timeline and realistic targets**
Current: ~$15K won / 5 months across 7 AEs = ~$3K/mo team-wide. Target: $35K MRR. We need to bridge this honestly. What's a realistic ramp? When do we expect new hires to be productive?

**2. AI as competitive advantage — show, don't tell**
We now have hard data from transcript analysis. We know exactly what our best closers did differently. We can score every demo. We can identify specific coaching points per AE. This is a demo culture change powered by AI. Worth showcasing to the board.

**3. Hiring authority and budget**
Need to move fast on 2-3 senior AE hires. What's the comp range? Can I make offers without escalation? Timeline?

**4. Edgar situation**
He's been here 18 months, never hit quota. I have verbal documentation but need to formalize before any action. HR should be looped in. What's our PIP process and timeline?

**5. The AI-first sales team vision**
CEO is AI-focused. We're building it: AI-scored demos, AI-extracted patterns, AI-driven coaching. Where does she see this going? Can we pitch SalesCloser as an AI-native sales org to prospects? (Our product IS AI — our sales process should match.)

### With CTO

**1. Report card bugs — need engineering time**
Three bugs in fill-report-card.js. Demo count inflation, pipeline health thresholds, stage ID verification. I have the fixes spec'd out — need a dev to implement. How do I get this prioritized?

**2. Pipedrive automation for deal velocity**
Proposal: auto-notify AE + manager when deal sits in Demo Held > 3 days. Auto-escalate at 7 days. Auto-move to Nurture at 14 days. Is this something we can build internally, or do we use Pipedrive workflows?

**3. Fireflies integration gaps**
We can access 2025 transcripts by ID but can't list/browse them through the API. Is there a way to get fuller API access or a different integration tier? This matters for coaching and historical analysis.

**4. Data pipeline: Pipedrive → scoring → coaching dashboard**
Right now Killer Calls scores demos independently. Can we connect Pipedrive stage changes, deal values, and close velocity into the same dashboard? This would give us per-AE: demos this week, avg close score, deal velocity, revenue. Full picture.

### With Head of Customer Support

**1. Post-sale handoff process**
James Anderson's transcripts show a clean pattern: Demo → Close Call → Onboarding (handoff to Kemal Wahju or team). Our current process? Are we losing deals in the handoff? Are new customers getting a smooth onboarding experience?

**2. Customer health signals from support**
Are there patterns in support tickets that could feed back to sales? Common objections? Feature requests? Implementation friction? I want to close the loop between what we sell and what gets delivered.

**3. White-label / KOC customer experience**
Tejinder, Mohsin Veerani — longer calls, complex deals. Are these customers successful post-sale? If white-label is a growing segment, we should align sales promises with delivery reality.

### With HR

**1. Edgar — PIP documentation and process**
I've been managing this verbally. Need to formalize. What's the required documentation? Timeline? What support does HR provide during a PIP?

**2. Vanessa — performance coaching, not PIP**
Confidence crisis, not a capability issue. Two periods of $0 MRR. I want to rebuild her momentum with coaching and tighter deal management, not a PIP right now. HR should know the context.

**3. New AE hiring — job description, comp, onboarding**
What's the approved JD and comp band? Timeline from offer to start? Onboarding process — who owns what?

**4. Team morale and turnover context**
We lost Zach and Marysol in March. Team is 7 people who've seen underperformance and departures. How do we message the turnaround without spooking people? Any retention risks HR is tracking?

---

## Quick Talking Points (If Asked)

- **"What's the biggest challenge?"** → Velocity. Deals sit too long. James closed in 4 days median. Current team is weeks. Fixing this is pipelines, pricing speed, and close training.
- **"What's working?"** → The data. We now have transcript-level visibility into every demo. We know what good looks like and can coach to it.
- **"What do you need?"** → Engineering time for report card fixes and Pipedrive automation. Hiring authority to move fast on AE candidates. HR support for Edgar PIP process.
- **"Where will we be in 90 days?"** → 9-10 AEs (current 7 + 2-3 new hires). QUICK framework institutionalized. Deal velocity dashboard live. Every AE demo scored and coached. Targeting $20K+ MRR team-wide.

---

*Prepared with transcript data from 53 James Anderson demos, 636 scored current-team demos, and Pipedrive CRM analysis.*
