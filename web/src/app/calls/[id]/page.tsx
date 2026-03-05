import { getDb } from "@/lib/db";
import { ScorecardRow, Scorecard, SpicedElement, BantElement, CloseStepElement, CriterionScore } from "@/lib/types";
import { notFound } from "next/navigation";
import Link from "next/link";
import "./call-detail.css";

const PHASE_META: Record<string, { label: string; num: number; maxPoints: number }> = {
  preCall: { label: "Pre-Call Prep", num: 1, maxPoints: 6 },
  discovery: { label: "Discovery", num: 2, maxPoints: 32 },
  presentation: { label: "Presentation", num: 3, maxPoints: 22 },
  pricing: { label: "Pricing & Objections", num: 4, maxPoints: 28 },
  closing: { label: "Close & Next Steps", num: 5, maxPoints: 12 },
};

const CRITERIA_LABELS: Record<string, string> = {
  research: "AE demonstrated research and preparation",
  agenda: "Set a proper agenda at call open",
  spiced: "SPICED discovery (all 5 elements)",
  smooth: "Presentation was smooth and professional",
  talkRatio: "AE avoided long monologues (talk ratio)",
  personalization: "Presentation was personalized to the prospect",
  tieDowns: "AE used tie-downs to close as they go",
  valueSummary: "Provided value summary before stating price",
  simplePricing: "Discussed pricing simply with one option first",
  noDiscount: "Did NOT cave on discount/terms prematurely",
  ecir: "ECIR objection handling",
  closeExecution: "Close execution",
  pushToClose: "Close execution",
  followUp: "Scheduled a specific follow-up date and time",
};

const SPICED_WORDS: Record<string, string> = {
  s: "Situation", p: "Pain", i: "Impact", c: "Critical Event", e: "Decision",
};

const BANT_WORDS: Record<string, string> = {
  b: "Budget", a: "Authority", n: "Need", t: "Timeline",
};

function ragClass(rag: string): string {
  if (rag === "green" || rag === "g") return "g";
  if (rag === "yellow" || rag === "y") return "y";
  return "r";
}

function ragLabel(rag: string): string {
  if (rag === "green" || rag === "g") return "Green";
  if (rag === "yellow" || rag === "y") return "Yellow";
  return "Red";
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function scoreColor(rag: string): string {
  const r = ragClass(rag);
  if (r === "g") return "var(--green)";
  if (r === "y") return "var(--yellow)";
  return "var(--red)";
}

function phaseBarColor(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.8) return "var(--green)";
  if (pct >= 0.6) return "var(--yellow)";
  return "var(--red)";
}

function statusIcon(cls: string): string {
  if (cls === "g") return "\u2713";
  if (cls === "y") return "~";
  return "\u2717";
}

function statusWord(status: string): string {
  if (status === "strong") return "Strong";
  if (status === "partial") return "Partial";
  return "Missing";
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sql = getDb();
  const rows = await sql`SELECT * FROM scorecards WHERE id = ${id} LIMIT 1`;

  if (rows.length === 0) return notFound();

  const row = rows[0] as unknown as ScorecardRow;
  const sc: Scorecard = typeof row.scorecard_json === "string"
    ? JSON.parse(row.scorecard_json)
    : row.scorecard_json;

  const rc = ragClass(sc.rag);
  const ffBase = row.meeting_id ? `https://app.fireflies.ai/view/${row.meeting_id}` : null;

  return (
    <div className="report">
      {/* ── NAV ── */}
      <nav className="rpt-nav">
        <Link href="/" className="nav-brand">Killer Calls</Link>
        <span className="nav-sep">/</span>
        <span className="nav-crumb">{row.rep_name}</span>
        <span className="nav-sep">/</span>
        <span className="nav-crumb">{row.company_name}</span>
        <Link href="/" className="nav-back">&larr; Library</Link>
      </nav>

      {/* ── HERO ── */}
      <section className={`hero hero--${rc}`}>
        <div className="hero-glow" />

        <div className="hero-grid">
          {/* Left — Rep info */}
          <div className="hero-info">
            <div className="hero-avatar">{initials(row.rep_name)}</div>
            <div className="hero-details">
              <Link href={`/reps/${encodeURIComponent(row.rep_name)}`} className="hero-name">
                {row.rep_name}
              </Link>
              <div className="hero-prospect">
                {row.company_name}
                {row.call_type === "followup" && (
                  <span className="followup-tag">Follow-up Call</span>
                )}
              </div>
              <div className="hero-meta">
                <span>{row.call_date}</span>
                {row.duration_minutes && (
                  <><span className="meta-dot" /><span>{row.duration_minutes} min</span></>
                )}
              </div>
              {row.meeting_id && (
                <a
                  href={`https://app.fireflies.ai/view/${row.meeting_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hero-rec-btn"
                >
                  <span className="rec-icon">&#9654;</span> Recording
                </a>
              )}
            </div>
          </div>

          {/* Center — Score ring */}
          <div className="hero-score">
            <div
              className="score-ring"
              style={{
                "--score-pct": sc.score,
                "--ring-color": scoreColor(sc.rag),
              } as React.CSSProperties}
            >
              <div className="score-ring-track" />
              <div className="score-ring-center">
                <div className="score-num">{sc.score}</div>
                <div className="score-of">/100</div>
                <div className={`score-badge ${rc}`}>
                  <span className="badge-dot" />
                  {ragLabel(sc.rag)}
                </div>
              </div>
            </div>
          </div>

          {/* Right — Phase breakdown */}
          <div className="hero-phases">
            <div className="phases-hd">Score by Phase</div>
            {Object.entries(PHASE_META).map(([key, meta], i) => {
              const phase = sc.phases[key as keyof typeof sc.phases];
              const s = phase?.score ?? 0;
              const pct = meta.maxPoints > 0 ? (s / meta.maxPoints) * 100 : 0;
              const color = phaseBarColor(s, meta.maxPoints);
              return (
                <div className="ph-row" key={key} style={{ animationDelay: `${0.5 + i * 0.07}s` }}>
                  <span className="ph-label">{meta.label}</span>
                  <div className="ph-track">
                    <div className="ph-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className="ph-val" style={{ color }}>{s}<span className="ph-max">/{meta.maxPoints}</span></span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Verdict */}
        <div className="hero-verdict">
          <div className="verdict-bar" style={{ background: scoreColor(sc.rag) }} />
          <p className="verdict-text">{sc.verdict}</p>
        </div>
      </section>

      {/* ── SPICED ── */}
      <section className="section">
        <div className="sec-hd">
          <span className="sec-tag">Framework</span>
          <h2 className="sec-title">SPICED Discovery</h2>
        </div>

        <div className="grid-5">
          {(["s", "p", "i", "c", "e"] as const).map((key, i) => {
            const el: SpicedElement = sc.spiced[key];
            const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
            return (
              <div key={key} className={`fw-card fw-card--${cls}`} style={{ animationDelay: `${0.1 + i * 0.06}s` }}>
                <div className="fw-hd">
                  <span className={`fw-letter fw-letter--${cls}`}>{key.toUpperCase()}</span>
                  <span className={`fw-badge fw-badge--${cls}`}>{statusIcon(cls)} {statusWord(el.status)}</span>
                </div>
                <div className="fw-label">{SPICED_WORDS[key]}</div>
                <p className="fw-feedback">{el.feedback}</p>
                {el.timestamps?.length > 0 && (
                  <div className="fw-ts">
                    {el.timestamps.map((ts, j) =>
                      ffBase ? (
                        <a key={j} href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {ts}</a>
                      ) : (
                        <span key={j} className="ts-pill">&#9654; {ts}</span>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── BANT ── */}
      {sc.bant && (
        <section className="section">
          <div className="sec-hd">
            <span className="sec-tag">Qualification</span>
            <h2 className="sec-title">BANT</h2>
          </div>

          <div className="grid-4">
            {(["b", "a", "n", "t"] as const).map((key, i) => {
              const el: BantElement = sc.bant![key];
              const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
              return (
                <div key={key} className={`fw-card fw-card--${cls}`} style={{ animationDelay: `${0.1 + i * 0.06}s` }}>
                  <div className="fw-hd">
                    <span className={`fw-letter fw-letter--${cls}`}>{key.toUpperCase()}</span>
                    <span className={`fw-badge fw-badge--${cls}`}>{statusIcon(cls)} {statusWord(el.status)}</span>
                  </div>
                  <div className="fw-label">{BANT_WORDS[key]}</div>
                  <p className="fw-feedback">{el.feedback}</p>
                  {el.timestamps?.length > 0 && (
                    <div className="fw-ts">
                      {el.timestamps.map((ts, j) =>
                        ffBase ? (
                          <a key={j} href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {ts}</a>
                        ) : (
                          <span key={j} className="ts-pill">&#9654; {ts}</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── CLOSE EXECUTION ── */}
      {sc.close && sc.close.style !== "none" && (
        <section className="section">
          <div className="sec-hd">
            <span className="sec-tag">Close</span>
            <h2 className="sec-title">Close Execution</h2>
          </div>

          <div className="close-style-pill">{sc.close.styleName}</div>

          <div className="grid-3">
            {(["setup", "bridge", "ask"] as const).map((key, i) => {
              const el: CloseStepElement = sc.close![key];
              const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
              return (
                <div key={key} className={`fw-card fw-card--${cls}`} style={{ animationDelay: `${0.1 + i * 0.06}s` }}>
                  <div className="fw-hd">
                    <span className={`fw-letter fw-letter--${cls}`}>{i + 1}</span>
                    <span className={`fw-badge fw-badge--${cls}`}>{statusIcon(cls)} {statusWord(el.status)}</span>
                  </div>
                  <div className="fw-label">{el.label}</div>
                  <p className="fw-feedback">{el.feedback}</p>
                  {el.timestamps?.length > 0 && (
                    <div className="fw-ts">
                      {el.timestamps.map((ts, j) =>
                        ffBase ? (
                          <a key={j} href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {ts}</a>
                        ) : (
                          <span key={j} className="ts-pill">&#9654; {ts}</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── LEGACY SVC ── */}
      {!sc.close && sc.svc && (
        <section className="section">
          <div className="sec-hd">
            <span className="sec-tag">Close</span>
            <h2 className="sec-title">SVC Close</h2>
          </div>
          <div className="grid-3">
            {(["summarize", "surface", "commit"] as const).map((key, i) => {
              const el = sc.svc![key];
              const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
              const letter = key === "summarize" ? "S" : key === "surface" ? "V" : "C";
              const label = key === "summarize" ? "Summarize Value" : key === "surface" ? "Surface Concern" : "Commit";
              return (
                <div key={key} className={`fw-card fw-card--${cls}`} style={{ animationDelay: `${0.1 + i * 0.06}s` }}>
                  <div className="fw-hd">
                    <span className={`fw-letter fw-letter--${cls}`}>{letter}</span>
                    <span className={`fw-badge fw-badge--${cls}`}>{statusIcon(cls)} {statusWord(el.status)}</span>
                  </div>
                  <div className="fw-label">{label}</div>
                  <p className="fw-feedback">{el.feedback}</p>
                  {el.timestamps?.length > 0 && (
                    <div className="fw-ts">
                      {el.timestamps.map((ts, j) =>
                        ffBase ? (
                          <a key={j} href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {ts}</a>
                        ) : (
                          <span key={j} className="ts-pill">&#9654; {ts}</span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── CLOSING TIPS ── */}
      {sc.closingTips && sc.closingTips.length > 0 && (
        <section className="section">
          <div className="sec-hd">
            <span className="sec-tag">Coaching</span>
            <h2 className="sec-title">Closing Tips</h2>
          </div>

          <div className="tips-list">
            {sc.closingTips.map((tip, i) => (
              <div key={i} className="tip-row" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
                <div className="tip-num">{i + 1}</div>
                <p className="tip-text">{tip}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── FULL SCORECARD ── */}
      <section className="section">
        <div className="sec-hd">
          <span className="sec-tag">Detail</span>
          <h2 className="sec-title">Full Scorecard</h2>
        </div>

        {Object.entries(PHASE_META).map(([phaseKey, phaseMeta]) => {
          const phase = sc.phases[phaseKey as keyof typeof sc.phases];
          if (!phase) return null;

          return (
            <div key={phaseKey} className="phase-group">
              <div className="phase-divider">
                <span className="phase-num">0{phaseMeta.num}</span>
                <span className="phase-name">{phaseMeta.label}</span>
              </div>

              {Object.entries(phase.criteria).map(([critKey, crit]) => {
                const criterion = crit as CriterionScore;
                const cls = ragClass(criterion.rag);

                return (
                  <div key={critKey} className="crit-row">
                    <div className={`crit-icon crit-icon--${cls}`}>{cls === "g" ? "\u2713" : cls === "y" ? "~" : "\u2717"}</div>
                    <div className="crit-body">
                      <div className="crit-title">{CRITERIA_LABELS[critKey] || critKey}</div>
                      <p className="crit-feedback">{criterion.feedback}</p>
                      {/* ECIR objections detail */}
                      {critKey === "ecir" && criterion.objections && criterion.objections.length > 0 && (
                        <div className="ecir-detail">
                          {criterion.objections.map((obj, oi) => (
                            <div key={oi} className="ecir-obj">
                              <span className="ecir-topic">{obj.topic}</span>
                              {ffBase ? (
                                <a href={ffBase} target="_blank" rel="noopener noreferrer" className="ecir-ts">&#9654; {obj.timestamp}</a>
                              ) : (
                                <span className="ecir-ts">&#9654; {obj.timestamp}</span>
                              )}
                              <span className="ecir-steps">
                                <span className={obj.empathize ? "ecir-step ecir-step--pass" : "ecir-step ecir-step--fail"}>E</span>
                                <span className={obj.clarify ? "ecir-step ecir-step--pass" : "ecir-step ecir-step--fail"}>C</span>
                                <span className={obj.isolate ? "ecir-step ecir-step--pass" : "ecir-step ecir-step--fail"}>I</span>
                                <span className={obj.respond ? "ecir-step ecir-step--pass" : "ecir-step ecir-step--fail"}>R</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {criterion.timestamps?.length > 0 && (
                        <div className="crit-ts">
                          {criterion.timestamps.map((ts, j) =>
                            ffBase ? (
                              <a key={j} href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {ts}</a>
                            ) : (
                              <span key={j} className="ts-pill">&#9654; {ts}</span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                    <div className="crit-score">
                      <span className={`crit-pts crit-pts--${cls}`}>{criterion.score}</span>
                      <span className="crit-max">/{criterion.maxPoints}</span>
                      <div className="crit-bar">
                        <div
                          className={`crit-fill crit-fill--${cls}`}
                          style={{ width: `${criterion.maxPoints > 0 ? (criterion.score / criterion.maxPoints) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      {/* ── FLAGS ── */}
      {sc.flags && (sc.flags.enthusiasm?.detected || sc.flags.unprofessionalLanguage?.detected || sc.flags.prematureDisqualification?.detected) && (
        <section className="section">
          <div className="sec-hd">
            <span className="sec-tag">Signals</span>
            <h2 className="sec-title">Flags &amp; Highlights</h2>
          </div>
          {sc.flags.enthusiasm?.detected && (
            <div className="flag flag--gold">&#11088; {sc.flags.enthusiasm.note}</div>
          )}
          {sc.flags.unprofessionalLanguage?.detected && (
            <div className="flag flag--red">&#9888; {sc.flags.unprofessionalLanguage.note}</div>
          )}
          {sc.flags.prematureDisqualification?.detected && (
            <div className="flag flag--red">&#9888; {sc.flags.prematureDisqualification.note}</div>
          )}
        </section>
      )}

      {/* ── COACHING SUMMARY ── */}
      <section className="section">
        <div className="sec-hd">
          <span className="sec-tag">Review</span>
          <h2 className="sec-title">Coaching Summary</h2>
        </div>

        <div className="coach-grid">
          {sc.wins?.length > 0 && (
            <div className="coach-card">
              <div className="coach-hd coach-hd--wins">What Landed</div>
              <div className="coach-body">
                {sc.wins.map((win, i) => (
                  <div key={i} className="coach-item">
                    <span className="coach-bullet coach-bullet--wins">{i + 1}</span>
                    <span>{win}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sc.fixes?.length > 0 && (
            <div className="coach-card">
              <div className="coach-hd coach-hd--fixes">Priority Fixes</div>
              <div className="coach-body">
                {sc.fixes.map((fix, i) => (
                  <div key={i} className="coach-item">
                    <span className="coach-bullet coach-bullet--fixes">&rarr;</span>
                    <span>{fix}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── QUOTE ── */}
      {sc.quoteOfTheCall?.text && (
        <section className="section pullquote-section">
          <div className="pullquote">
            <div className="pq-mark">&ldquo;</div>
            <blockquote className="pq-text">{sc.quoteOfTheCall.text}</blockquote>
            <div className="pq-attr">
              {ffBase ? (
                <a href={ffBase} target="_blank" rel="noopener noreferrer" className="ts-pill">&#9654; {sc.quoteOfTheCall.timestamp}</a>
              ) : (
                <span className="ts-pill">&#9654; {sc.quoteOfTheCall.timestamp}</span>
              )}
              <span className="pq-context">{sc.quoteOfTheCall.context}</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
