"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import "./sales.css";

/* ───────────────────────────────────────────────────────
   Scroll-triggered animation hook
   ─────────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, className: visible ? "revealed" : "" };
}

/* ───────────────────────────────────────────────────────
   Count-up animation
   ─────────────────────────────────────────────────────── */
function CountUp({ target, suffix = "", prefix = "", duration = 1800 }: {
  target: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.round(eased * target));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          obs.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);

  return <span ref={ref}>{prefix}{value}{suffix}</span>;
}

/* ───────────────────────────────────────────────────────
   Score Ring SVG
   ─────────────────────────────────────────────────────── */
function ScoreRing({ score, size = 160 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "var(--green)" : score >= 60 ? "var(--yellow)" : "var(--red)";

  return (
    <svg width={size} height={size} className="score-ring-svg">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="score-ring-fill"
      />
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" dominantBaseline="central"
        className="score-ring-num" fill="var(--text)">{score}</text>
      <text x={size / 2} y={size / 2 + 18} textAnchor="middle"
        className="score-ring-label" fill="var(--muted)">/100</text>
    </svg>
  );
}

/* ───────────────────────────────────────────────────────
   Pip component
   ─────────────────────────────────────────────────────── */
function Pip({ letter, status }: { letter: string; status: "g" | "y" | "r" }) {
  return <div className={`sl-pip sl-pip--${status}`}>{letter}</div>;
}

/* ───────────────────────────────────────────────────────
   Phase Bar
   ─────────────────────────────────────────────────────── */
function PhaseBar({ label, score, max, delay }: { label: string; score: number; max: number; delay: number }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? "g" : pct >= 60 ? "y" : "r";
  return (
    <div className="sl-phase-bar" style={{ animationDelay: `${delay}s` }}>
      <div className="sl-phase-bar-hd">
        <span className="sl-phase-bar-name">{label}</span>
        <span className={`sl-phase-bar-score sl-phase-bar-score--${color}`}>{score}/{max}</span>
      </div>
      <div className="sl-phase-bar-track">
        <div className={`sl-phase-bar-fill sl-phase-bar-fill--${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SALES PAGE
   ═══════════════════════════════════════════════════════ */
export default function SalesClient() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [bottomEmail, setBottomEmail] = useState("");
  const [bottomSubmitted, setBottomSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const scrollToCTA = useCallback(() => {
    emailRef.current?.focus();
    emailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleSubmit = (e: React.FormEvent, which: "top" | "bottom") => {
    e.preventDefault();
    if (which === "top" && email.includes("@")) setSubmitted(true);
    if (which === "bottom" && bottomEmail.includes("@")) setBottomSubmitted(true);
  };

  const integrations = useReveal();
  const pain = useReveal();
  const steps = useReveal();
  const playbook = useReveal();
  const frameworks = useReveal();
  const preview = useReveal();
  const closes = useReveal();
  const proof = useReveal();
  const finalCta = useReveal();

  return (
    <div className="sl-page">
      {/* ── NAV ── */}
      <nav className="sl-nav">
        <div className="sl-nav-inner">
          <div className="sl-logo">
            <span className="sl-logo-icon">&#9654;</span>
            <span className="sl-logo-text">Killer Calls</span>
          </div>
          <button className="sl-nav-cta" onClick={scrollToCTA}>Join Waitlist</button>
        </div>
      </nav>

      {/* ═══ SECTION 1: HERO ═══ */}
      <section className="sl-hero">
        <div className="sl-hero-glow" />
        <div className="sl-hero-grid">
          <div className="sl-hero-copy">
            <div className="sl-hero-tag">AI-Powered Sales Coaching</div>
            <h1 className="sl-hero-h1">
              Every call scored.<br />
              Every rep coached.<br />
              <span className="sl-hero-accent">Zero manager hours.</span>
            </h1>
            <p className="sl-hero-sub">
              Stop guessing which reps need help. Killer Calls reviews every demo
              against a 100-point rubric and delivers coaching your team actually uses.
            </p>

            {!submitted ? (
              <form className="sl-cta-form" onSubmit={(e) => handleSubmit(e, "top")}>
                <input
                  ref={emailRef}
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="sl-cta-input"
                  required
                />
                <button type="submit" className="sl-cta-btn">Join the Waitlist</button>
              </form>
            ) : (
              <div className="sl-cta-confirmed">
                <span className="sl-cta-check">&#10003;</span>
                You&apos;re on the list. We&apos;ll be in touch.
              </div>
            )}
          </div>

          <div className="sl-hero-visual">
            <div className="sl-mock-card">
              <div className="sl-mock-hd">
                <div className="sl-mock-avatar">JA</div>
                <div>
                  <div className="sl-mock-rep">Jake Anderson</div>
                  <div className="sl-mock-company">Acme Corp</div>
                </div>
                <div className="sl-mock-ring">
                  <ScoreRing score={82} size={100} />
                </div>
              </div>
              <div className="sl-mock-phases">
                <PhaseBar label="Pre-Call" score={5} max={6} delay={0.3} />
                <PhaseBar label="Discovery" score={26} max={32} delay={0.4} />
                <PhaseBar label="Presentation" score={18} max={22} delay={0.5} />
                <PhaseBar label="Pricing" score={22} max={28} delay={0.6} />
                <PhaseBar label="Close" score={11} max={12} delay={0.7} />
              </div>
              <div className="sl-mock-pips">
                <div className="sl-mock-pip-label">SPICED</div>
                <div className="sl-mock-pip-row">
                  <Pip letter="S" status="g" />
                  <Pip letter="P" status="g" />
                  <Pip letter="I" status="y" />
                  <Pip letter="C" status="g" />
                  <Pip letter="E" status="g" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ INTEGRATIONS BAR ═══ */}
      <section className={`sl-section sl-integrations ${integrations.className}`} ref={integrations.ref}>
        <div className="sl-section-inner">
          <div className="sl-int-label">Works with your meeting tools</div>
          <div className="sl-int-logos">
            <div className="sl-int-logo">
              <svg viewBox="0 0 120 28" className="sl-int-svg">
                <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <circle cx="11" cy="11" r="2" fill="currentColor" opacity="0.7" />
                <circle cx="17" cy="11" r="2" fill="currentColor" opacity="0.7" />
                <path d="M10 16 Q14 20 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                <text x="30" y="18" fill="currentColor" fontSize="14" fontFamily="var(--font-display)" fontWeight="600">Fireflies</text>
              </svg>
            </div>
            <div className="sl-int-logo">
              <svg viewBox="0 0 110 28" className="sl-int-svg">
                <rect x="4" y="6" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <path d="M8 14 L12 18 L18 10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7" />
                <text x="26" y="18" fill="currentColor" fontSize="14" fontFamily="var(--font-display)" fontWeight="600">Granola</text>
              </svg>
            </div>
            <div className="sl-int-logo">
              <svg viewBox="0 0 100 28" className="sl-int-svg">
                <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <path d="M9 14 L14 9 L19 14 L14 19 Z" fill="currentColor" opacity="0.5" />
                <text x="28" y="18" fill="currentColor" fontSize="14" fontFamily="var(--font-display)" fontWeight="600">Otter.ai</text>
              </svg>
            </div>
            <div className="sl-int-logo">
              <svg viewBox="0 0 90 28" className="sl-int-svg">
                <path d="M4 18 L10 8 L16 18 L22 8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
                <text x="28" y="18" fill="currentColor" fontSize="14" fontFamily="var(--font-display)" fontWeight="600">Gong</text>
              </svg>
            </div>
            <div className="sl-int-logo">
              <svg viewBox="0 0 108 28" className="sl-int-svg">
                <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <path d="M10 12 L14 8 L18 12" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                <line x1="14" y1="8" x2="14" y2="20" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                <text x="28" y="18" fill="currentColor" fontSize="14" fontFamily="var(--font-display)" fontWeight="600">Fathom</text>
              </svg>
            </div>
            <div className="sl-int-logo">
              <svg viewBox="0 0 80 28" className="sl-int-svg">
                <rect x="4" y="7" width="16" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                <circle cx="12" cy="14" r="3" fill="currentColor" opacity="0.4" />
                <text x="24" y="18" fill="currentColor" fontSize="13" fontFamily="var(--font-display)" fontWeight="600">tl;dv</text>
              </svg>
            </div>
          </div>
          <div className="sl-int-note">Any tool that produces a transcript. Plug in and go.</div>
        </div>
      </section>

      {/* ═══ SECTION 2: THE COACHING GAP ═══ */}
      <section className={`sl-section sl-pain ${pain.className}`} ref={pain.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">The Problem</div>
          <h2 className="sl-sec-h2">The Coaching Gap</h2>
          <p className="sl-sec-sub">
            Your best reps are flying blind. Managers review a fraction of calls.
            By the time feedback arrives, the prospect has ghosted.
          </p>
          <div className="sl-pain-grid">
            <div className="sl-pain-card">
              <div className="sl-pain-num"><CountUp target={5} suffix="%" /></div>
              <div className="sl-pain-label">of calls reviewed by managers</div>
            </div>
            <div className="sl-pain-card">
              <div className="sl-pain-num"><CountUp target={2} suffix=" weeks" /></div>
              <div className="sl-pain-label">average feedback delay</div>
            </div>
            <div className="sl-pain-card">
              <div className="sl-pain-num"><CountUp target={0} prefix="$" /></div>
              <div className="sl-pain-label">spent on rep self-coaching tools</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: HOW IT WORKS ═══ */}
      <section className={`sl-section sl-steps ${steps.className}`} ref={steps.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">How It Works</div>
          <h2 className="sl-sec-h2">Three steps. Zero effort.</h2>
          <div className="sl-steps-grid">
            <div className="sl-step">
              <div className="sl-step-num">01</div>
              <div className="sl-step-icon">&#127908;</div>
              <div className="sl-step-title">Record</div>
              <div className="sl-step-desc">Fireflies captures every demo call automatically. No setup, no extra tools.</div>
            </div>
            <div className="sl-step-arrow">&#8594;</div>
            <div className="sl-step">
              <div className="sl-step-num">02</div>
              <div className="sl-step-icon">&#9889;</div>
              <div className="sl-step-title">Score</div>
              <div className="sl-step-desc">AI analyzes the transcript against 14 criteria across 5 call phases. 100-point rubric.</div>
            </div>
            <div className="sl-step-arrow">&#8594;</div>
            <div className="sl-step">
              <div className="sl-step-num">03</div>
              <div className="sl-step-icon">&#127919;</div>
              <div className="sl-step-title">Coach</div>
              <div className="sl-step-desc">Reps get instant, specific, actionable coaching with timestamps and closing tips.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ YOUR PLAYBOOK ═══ */}
      <section className={`sl-section sl-playbook ${playbook.className}`} ref={playbook.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">Customizable</div>
          <h2 className="sl-sec-h2">Your playbook. Your metrics.</h2>
          <p className="sl-sec-sub">
            Get insights based on your playbooks and GTM strategy. Define the criteria that matter to your team — Killer Calls scores against them.
          </p>
          <div className="sl-pb-grid">
            <div className="sl-pb-card">
              <div className="sl-pb-icon">&#9881;</div>
              <div className="sl-pb-title">Custom Scoring Criteria</div>
              <div className="sl-pb-desc">
                Add, remove, or reweight any scoring criterion. Running MEDDIC instead of BANT? Swap it in. Your rubric, your rules.
              </div>
            </div>
            <div className="sl-pb-card">
              <div className="sl-pb-icon">&#128202;</div>
              <div className="sl-pb-title">Team-Level Benchmarks</div>
              <div className="sl-pb-desc">
                Set target scores by role, segment, or deal size. New SDR ramping? Different bar. Enterprise AE? Higher standard.
              </div>
            </div>
            <div className="sl-pb-card">
              <div className="sl-pb-icon">&#127919;</div>
              <div className="sl-pb-title">Framework Flexibility</div>
              <div className="sl-pb-desc">
                Choose which frameworks get scored — SPICED, BANT, ECIR, or bring your own. The coaching engine adapts to your methodology.
              </div>
            </div>
            <div className="sl-pb-card">
              <div className="sl-pb-icon">&#128172;</div>
              <div className="sl-pb-title">Coaching Voice</div>
              <div className="sl-pb-desc">
                Set the tone — tough love, encouraging, data-only. Match the coaching style your reps respond to best.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: FRAMEWORKS ═══ */}
      <section className={`sl-section sl-frameworks ${frameworks.className}`} ref={frameworks.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">Frameworks</div>
          <h2 className="sl-sec-h2">Built on real sales science</h2>
          <p className="sl-sec-sub">Not a checklist. A coaching system.</p>
          <div className="sl-fw-grid">
            <div className="sl-fw-card">
              <div className="sl-fw-name">SPICED</div>
              <div className="sl-fw-role">Discovery</div>
              <div className="sl-fw-pips">
                <Pip letter="S" status="g" />
                <Pip letter="P" status="g" />
                <Pip letter="I" status="r" />
                <Pip letter="C" status="y" />
                <Pip letter="E" status="g" />
              </div>
              <div className="sl-fw-desc">
                Situation, Pain, Impact, Critical Event, Decision. Each element scored independently — because Impact is missed 80% of the time.
              </div>
            </div>
            <div className="sl-fw-card">
              <div className="sl-fw-name">BANT</div>
              <div className="sl-fw-role">Qualification</div>
              <div className="sl-fw-pips">
                <Pip letter="B" status="y" />
                <Pip letter="A" status="g" />
                <Pip letter="N" status="g" />
                <Pip letter="T" status="r" />
              </div>
              <div className="sl-fw-desc">
                Budget, Authority, Need, Timeline. Evaluated separately from the score — because qualification and coaching are different conversations.
              </div>
            </div>
            <div className="sl-fw-card">
              <div className="sl-fw-name">ECIR</div>
              <div className="sl-fw-role">Objection Handling</div>
              <div className="sl-fw-pips">
                <Pip letter="E" status="g" />
                <Pip letter="C" status="g" />
                <Pip letter="I" status="y" />
                <Pip letter="R" status="g" />
              </div>
              <div className="sl-fw-desc">
                Empathize, Clarify, Isolate, Respond. Scored per objection, then averaged. If no objections were raised, that&apos;s a zero.
              </div>
            </div>
            <div className="sl-fw-card">
              <div className="sl-fw-name">Close</div>
              <div className="sl-fw-role">Execution</div>
              <div className="sl-fw-pips">
                <Pip letter="S" status="g" />
                <Pip letter="B" status="y" />
                <Pip letter="A" status="g" />
              </div>
              <div className="sl-fw-desc">
                Three closing styles — Consultative, Assumptive, Urgency. AI identifies which style the rep used and scores Setup, Bridge, Ask.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: SCORECARD PREVIEW ═══ */}
      <section className={`sl-section sl-preview ${preview.className}`} ref={preview.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">The Product</div>
          <h2 className="sl-sec-h2">See what your reps see</h2>
          <p className="sl-sec-sub">
            Not a number on a spreadsheet. A tactical debrief for every single call.
          </p>

          <div className="sl-preview-card">
            {/* Mock verdict */}
            <div className="sl-prev-verdict">
              <div className="sl-prev-verdict-label">Verdict</div>
              <div className="sl-prev-verdict-text">
                &ldquo;Strong discovery and smooth demo, but Jake left $40K on the table by not
                quantifying Impact before jumping to pricing — a direct &lsquo;what does that
                cost you per month?&rsquo; would have anchored the value.&rdquo;
              </div>
            </div>

            {/* Mock closing tip */}
            <div className="sl-prev-section">
              <div className="sl-prev-section-tag">Closing Tips</div>
              <div className="sl-prev-tip">
                <span className="sl-prev-tip-num">1</span>
                At 34:12 when the prospect said &ldquo;we need to think about it,&rdquo; pivot to:
                &ldquo;Totally fair — what specifically do you need to think through?&rdquo; This isolates the real objection.
              </div>
              <div className="sl-prev-tip">
                <span className="sl-prev-tip-num">2</span>
                Before stating price, recap the three pain points they mentioned — &ldquo;You told me
                X costs you Y per month&rdquo; — so the number lands in context, not a vacuum.
              </div>
            </div>

            {/* Mock quote */}
            <div className="sl-prev-section">
              <div className="sl-prev-section-tag">Quote of the Call</div>
              <div className="sl-prev-quote">
                <div className="sl-prev-quote-text">
                  &ldquo;Honestly, this is the first demo where someone actually understood our workflow
                  before showing me features.&rdquo;
                </div>
                <div className="sl-prev-quote-meta">
                  &#9654; 22:45 &middot; Prospect &middot; This moment proves discovery was thorough — build on this.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 6: THREE CLOSING STYLES ═══ */}
      <section className={`sl-section sl-closes ${closes.className}`} ref={closes.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">Close Execution</div>
          <h2 className="sl-sec-h2">One size doesn&apos;t fit all</h2>
          <p className="sl-sec-sub">
            Three closing styles. The AI identifies which one the rep used — then scores the execution.
          </p>
          <div className="sl-close-grid">
            <div className="sl-close-card sl-close-card--a">
              <div className="sl-close-style">A</div>
              <div className="sl-close-name">Consultative Close</div>
              <div className="sl-close-when">Best when discovery was thorough</div>
              <div className="sl-close-steps">
                <div className="sl-close-step"><span className="sl-close-step-n">1</span> Summarize Value</div>
                <div className="sl-close-step"><span className="sl-close-step-n">2</span> Surface Blockers</div>
                <div className="sl-close-step"><span className="sl-close-step-n">3</span> Ask for Commitment</div>
              </div>
            </div>
            <div className="sl-close-card sl-close-card--b">
              <div className="sl-close-style">B</div>
              <div className="sl-close-name">Assumptive Close</div>
              <div className="sl-close-when">Best when buying signals are strong</div>
              <div className="sl-close-steps">
                <div className="sl-close-step"><span className="sl-close-step-n">1</span> Read Buying Signals</div>
                <div className="sl-close-step"><span className="sl-close-step-n">2</span> Smooth Transition</div>
                <div className="sl-close-step"><span className="sl-close-step-n">3</span> Lock Specific Action</div>
              </div>
            </div>
            <div className="sl-close-card sl-close-card--c">
              <div className="sl-close-style">C</div>
              <div className="sl-close-name">Urgency Close</div>
              <div className="sl-close-when">Best when a real deadline exists</div>
              <div className="sl-close-steps">
                <div className="sl-close-step"><span className="sl-close-step-n">1</span> Tie to Critical Event</div>
                <div className="sl-close-step"><span className="sl-close-step-n">2</span> Build the Timeline</div>
                <div className="sl-close-step"><span className="sl-close-step-n">3</span> Propose the Plan</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 7: SOCIAL PROOF ═══ */}
      <section className={`sl-section sl-proof ${proof.className}`} ref={proof.ref}>
        <div className="sl-section-inner">
          <div className="sl-sec-tag">Proven</div>
          <h2 className="sl-sec-h2">Battle-tested internally. Ready for your team.</h2>
          <div className="sl-proof-pills">
            <div className="sl-proof-pill"><CountUp target={80} suffix="+" /> calls scored</div>
            <div className="sl-proof-pill"><CountUp target={9} /> AEs coached</div>
            <div className="sl-proof-pill"><CountUp target={14} /> scoring criteria</div>
            <div className="sl-proof-pill"><CountUp target={3} /> closing styles</div>
            <div className="sl-proof-pill"><CountUp target={5} /> call phases</div>
            <div className="sl-proof-pill"><CountUp target={100} /> point rubric</div>
          </div>
          <blockquote className="sl-proof-quote">
            &ldquo;This is the first tool where my reps actually read their own feedback.
            They check their scores before I even get to it.&rdquo;
          </blockquote>
        </div>
      </section>

      {/* ═══ SECTION 8: FINAL CTA ═══ */}
      <section className={`sl-section sl-final ${finalCta.className}`} ref={finalCta.ref}>
        <div className="sl-section-inner">
          <h2 className="sl-final-h2">Stop leaving deals on the table.</h2>
          <p className="sl-final-sub">
            Be first in line when we open access.
          </p>
          {!bottomSubmitted ? (
            <form className="sl-cta-form sl-cta-form--center" onSubmit={(e) => handleSubmit(e, "bottom")}>
              <input
                type="email"
                placeholder="you@company.com"
                value={bottomEmail}
                onChange={(e) => setBottomEmail(e.target.value)}
                className="sl-cta-input"
                required
              />
              <button type="submit" className="sl-cta-btn">Join the Waitlist</button>
            </form>
          ) : (
            <div className="sl-cta-confirmed sl-cta-confirmed--center">
              <span className="sl-cta-check">&#10003;</span>
              You&apos;re on the list. We&apos;ll be in touch.
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="sl-footer">
        <div className="sl-footer-inner">
          <span className="sl-footer-logo">&#9654; Killer Calls</span>
          <span className="sl-footer-copy">&copy; {new Date().getFullYear()} SalesCloser.ai</span>
        </div>
      </footer>
    </div>
  );
}
