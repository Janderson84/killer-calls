import { getDb } from "@/lib/db";
import { ScorecardRow, Scorecard, SpicedElement, BantElement, SvcElement, CriterionScore } from "@/lib/types";
import { notFound } from "next/navigation";
import Link from "next/link";
import "./call-detail.css";

const PHASE_META: Record<string, { label: string; num: number; maxPoints: number }> = {
  preCall: { label: "Pre-Call Preparation", num: 1, maxPoints: 6 },
  discovery: { label: "Discovery", num: 2, maxPoints: 32 },
  presentation: { label: "Presentation", num: 3, maxPoints: 22 },
  pricing: { label: "Pricing & Objection Handling", num: 4, maxPoints: 28 },
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
  pushToClose: "Pushed to close the deal on the call",
  svc: "SVC Close (Summarize → Surface Concern → Commit)",
  followUp: "Scheduled a specific follow-up date and time",
};

const SPICED_WORDS: Record<string, string> = {
  s: "Situation",
  p: "Pain",
  i: "Impact",
  c: "Critical Event",
  e: "Decision",
};

const BANT_WORDS: Record<string, string> = {
  b: "Budget",
  a: "Authority",
  n: "Need",
  t: "Timeline",
};

const SVC_WORDS: Record<string, string> = {
  summarize: "Summarize Value",
  surface: "Surface Concern",
  commit: "Commit",
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
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

  const overallRag = ragClass(sc.rag);
  const borderClass = overallRag === "g" ? "header-card-green" : overallRag === "y" ? "header-card-yellow" : "header-card-red";

  return (
    <>
      {/* NAV */}
      <div className="nav">
        <Link href="/">Killer Calls</Link>
        <span className="nav-sep">&rsaquo;</span>
        <span>{row.rep_name} &rarr; {row.company_name}</span>
        <span className="nav-sep">&middot;</span>
        <span>{row.call_date}</span>
        <span style={{ marginLeft: "auto" }}>
          <Link href="/">&larr; Back to library</Link>
        </span>
      </div>

      <div className="layout">
        <div className="main">
          {/* HEADER CARD */}
          <div className={`header-card ${borderClass}`}>
            <div className="header-top">
              <div className="header-rep">
                <div className="avatar-lg">{initials(row.rep_name)}</div>
                <div>
                  <div className="rep-name-lg">{row.rep_name}</div>
                  <div className="rep-meta-row">
                    <div className="rep-meta-item">
                      <span>{row.company_name}</span>
                    </div>
                    <div className="rep-meta-item">
                      <span>{row.call_date}</span>
                    </div>
                    {row.duration_minutes && (
                      <div className="rep-meta-item">
                        <span>{row.duration_minutes} min</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {row.meeting_id && (
                <a
                  href={`https://app.fireflies.ai/view/${row.meeting_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fireflies-link"
                >
                  ▶ View Recording
                </a>
              )}
              <div className="score-block">
                <div className="score-label">Overall Score</div>
                <div className="score-big" style={{ color: scoreColor(sc.rag) }}>
                  {sc.score}<small>/100</small>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={`score-rag rag-${overallRag}`}>
                    <span className="rag-dot"></span> {ragLabel(sc.rag)}
                  </span>
                </div>
              </div>
            </div>
            <div className="verdict-row">
              <div className="verdict-bar" style={{ background: scoreColor(sc.rag) }}></div>
              <div>
                <div className="verdict-label" style={{ color: scoreColor(sc.rag) }}>Verdict</div>
                <div className="verdict-text">{sc.verdict}</div>
              </div>
            </div>
          </div>

          {/* SPICED BREAKDOWN */}
          <div className="section-hd">
            <div className="section-hd-title">SPICED Breakdown</div>
          </div>

          <div className="spiced-grid">
            {(["s", "p", "i", "c", "e"] as const).map((key) => {
              const el: SpicedElement = sc.spiced[key];
              const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
              const statusLabel = el.status === "strong" ? "Strong" : el.status === "partial" ? "Partial" : "Missing";
              return (
                <div key={key} className={`spiced-card ${cls}`}>
                  <div className="spiced-letter">{key.toUpperCase()}</div>
                  <div className="spiced-word">{SPICED_WORDS[key]}</div>
                  <div className="spiced-status">
                    {cls === "g" ? "✓" : cls === "y" ? "~" : "✗"} {statusLabel}
                  </div>
                  <div className="spiced-note">{el.feedback}</div>
                  {el.timestamps && el.timestamps.length > 0 && (
                    <div className="spiced-ts">
                      {el.timestamps.map((ts, i) => (
                        <span key={i}>▶ {ts}{i < el.timestamps.length - 1 ? " · " : ""}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* BANT BREAKDOWN */}
          {sc.bant && (
            <>
              <div className="section-hd">
                <div className="section-hd-title">BANT Qualification</div>
              </div>

              <div className="bant-grid">
                {(["b", "a", "n", "t"] as const).map((key) => {
                  const el: BantElement = sc.bant![key];
                  const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
                  const statusLabel = el.status === "strong" ? "Strong" : el.status === "partial" ? "Partial" : "Missing";
                  return (
                    <div key={key} className={`bant-card ${cls}`}>
                      <div className="bant-letter">{key.toUpperCase()}</div>
                      <div className="bant-word">{BANT_WORDS[key]}</div>
                      <div className="bant-status">
                        {cls === "g" ? "\u2713" : cls === "y" ? "~" : "\u2717"} {statusLabel}
                      </div>
                      <div className="bant-note">{el.feedback}</div>
                      {el.timestamps && el.timestamps.length > 0 && (
                        <div className="bant-ts">
                          {el.timestamps.map((ts, i) => (
                            <span key={i}>{"\u25B6"} {ts}{i < el.timestamps.length - 1 ? " \u00B7 " : ""}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* SVC CLOSE BREAKDOWN */}
          {sc.svc && (
            <>
              <div className="section-hd">
                <div className="section-hd-title">SVC Close</div>
              </div>

              <div className="svc-grid">
                {(["summarize", "surface", "commit"] as const).map((key) => {
                  const el: SvcElement = sc.svc![key];
                  const cls = el.status === "strong" ? "g" : el.status === "partial" ? "y" : "r";
                  const statusLabel = el.status === "strong" ? "Strong" : el.status === "partial" ? "Partial" : "Missing";
                  const letter = key === "summarize" ? "S" : key === "surface" ? "V" : "C";
                  return (
                    <div key={key} className={`svc-card ${cls}`}>
                      <div className="svc-letter">{letter}</div>
                      <div className="svc-word">{SVC_WORDS[key]}</div>
                      <div className="svc-status">
                        {cls === "g" ? "\u2713" : cls === "y" ? "~" : "\u2717"} {statusLabel}
                      </div>
                      <div className="svc-note">{el.feedback}</div>
                      {el.timestamps && el.timestamps.length > 0 && (
                        <div className="svc-ts">
                          {el.timestamps.map((ts, i) => (
                            <span key={i}>{"\u25B6"} {ts}{i < el.timestamps.length - 1 ? " \u00B7 " : ""}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* FULL SCORECARD */}
          <div className="section-hd">
            <div className="section-hd-title">Full Scorecard</div>
          </div>

          {Object.entries(PHASE_META).map(([phaseKey, phaseMeta]) => {
            const phase = sc.phases[phaseKey as keyof typeof sc.phases];
            if (!phase) return null;

            return (
              <div key={phaseKey}>
                <div className="phase-label" style={{ marginTop: phaseKey === "preCall" ? 0 : 20 }}>
                  Phase {phaseMeta.num} &middot; {phaseMeta.label}
                </div>

                {Object.entries(phase.criteria).map(([critKey, crit]) => {
                  const criterion = crit as CriterionScore;
                  const cls = ragClass(criterion.rag);
                  const icon = cls === "g" ? "✓" : cls === "y" ? "~" : "✗";

                  return (
                    <div key={critKey} className="criterion-row">
                      <div className={`cr-rag ${cls}`}>{icon}</div>
                      <div className="cr-content">
                        <div className="cr-title">
                          {CRITERIA_LABELS[critKey] || critKey}
                        </div>
                        <div className="cr-feedback">{criterion.feedback}</div>
                        {criterion.timestamps && criterion.timestamps.length > 0 && (
                          <div className="cr-timestamps">
                            {criterion.timestamps.map((ts, i) => (
                              <span key={i} className="ts-chip">▶ {ts}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="cr-score">
                        <div className={`cr-score-num ${cls}`}>{criterion.score}</div>
                        <div className="cr-score-max">/ {criterion.maxPoints}</div>
                        <div className="cr-score-bar">
                          <div
                            className={`cr-score-fill ${cls}`}
                            style={{ width: `${(criterion.score / criterion.maxPoints) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* FLAGS */}
          {sc.flags && (
            <>
              <div className="section-hd">
                <div className="section-hd-title">Flags & Highlights</div>
              </div>
              {sc.flags.enthusiasm?.detected && (
                <div className="flag-row gold-flag">⭐ {sc.flags.enthusiasm.note}</div>
              )}
              {sc.flags.unprofessionalLanguage?.detected && (
                <div className="flag-row">⚠ {sc.flags.unprofessionalLanguage.note}</div>
              )}
              {sc.flags.prematureDisqualification?.detected && (
                <div className="flag-row">⚠ {sc.flags.prematureDisqualification.note}</div>
              )}
            </>
          )}

          {/* COACHING SUMMARY */}
          <div className="section-hd">
            <div className="section-hd-title">Coaching Summary</div>
          </div>

          {sc.wins && sc.wins.length > 0 && (
            <div className="coaching-block">
              <div className="coaching-block-header wins">✅ What landed</div>
              <div className="coaching-block-body">
                {sc.wins.map((win, i) => (
                  <div key={i} className="coaching-item">
                    <span className="coaching-item-icon">{i + 1}.</span>
                    <span>{win}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sc.fixes && sc.fixes.length > 0 && (
            <div className="coaching-block">
              <div className="coaching-block-header fixes">🔧 Priority fixes</div>
              <div className="coaching-block-body">
                {sc.fixes.map((fix, i) => (
                  <div key={i} className="coaching-item">
                    <span className="coaching-item-icon">&rarr;</span>
                    <span>{fix}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sc.quoteOfTheCall?.text && (
            <div className="coaching-block">
              <div className="coaching-block-header quote">💬 Quote of the call</div>
              <div className="coaching-block-body">
                <div className="coaching-quote">
                  &ldquo;{sc.quoteOfTheCall.text}&rdquo;
                  <div className="coaching-quote-ts">
                    ▶ {sc.quoteOfTheCall.timestamp} — {sc.quoteOfTheCall.context}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Score by phase</div>
            <div className="score-breakdown">
              {Object.entries(PHASE_META).map(([phaseKey, phaseMeta]) => {
                const phase = sc.phases[phaseKey as keyof typeof sc.phases];
                const phaseScore = phase?.score ?? 0;
                const max = phaseMeta.maxPoints;
                const pct = max > 0 ? (phaseScore / max) * 100 : 0;
                const color = phaseBarColor(phaseScore, max);

                return (
                  <div key={phaseKey} className="score-phase-row">
                    <div className="score-phase-name">{phaseMeta.label}</div>
                    <div className="score-phase-bar-wrap">
                      <div
                        className="score-phase-bar"
                        style={{ width: `${pct}%`, background: color }}
                      ></div>
                    </div>
                    <div className="score-phase-val" style={{ color }}>
                      {phaseScore}/{max}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
