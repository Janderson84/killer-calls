"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { buildRepSummary } from "@/lib/chart-utils";
import RepSparkCard from "./RepSparkCard";

export interface CallRow {
  id: string;
  meeting_id: string;
  rep_name: string;
  company_name: string;
  call_date: string;
  duration_minutes: number;
  score: number;
  rag: string;
  verdict: string;
  spiced_s: string;
  spiced_p: string;
  spiced_i: string;
  spiced_c: string;
  spiced_e: string;
  bant_b: string;
  bant_a: string;
  bant_n: string;
  bant_t: string;
  call_type: string;
  created_at: string;
}

type Period = "7d" | "30d" | "90d" | "all";
type SortKey = "score" | "rep" | "prospect" | "rag" | "date" | "duration";
type SortDir = "asc" | "desc";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

function ragClass(rag: string): string {
  if (rag === "green") return "g";
  if (rag === "yellow") return "y";
  return "r";
}

function ragLabel(rag: string): string {
  if (rag === "green") return "Green";
  if (rag === "yellow") return "Yellow";
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

function pipClass(status: string): string {
  if (status === "strong") return "g";
  if (status === "partial") return "y";
  return "r";
}

function parseCallDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return new Date(0);
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

const PAGE_SIZE = 20;

export default function LibraryClient({ rows, activeReps, teamSlug, teamName }: { rows: CallRow[]; activeReps?: string[] | null; teamSlug?: string; teamName?: string }) {
  const basePath = teamSlug ? `/t/${teamSlug}` : "";
  const [period, setPeriod] = useState<Period>("all");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    if (period === "all") return rows;
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const cutoff = daysAgo(days);
    return rows.filter((r) => parseCallDate(r.call_date) >= cutoff);
  }, [rows, period]);

  const ragOrder: Record<string, number> = { green: 3, yellow: 2, red: 1 };

  const ranked = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "score":
          cmp = a.score - b.score;
          break;
        case "rep":
          cmp = a.rep_name.localeCompare(b.rep_name);
          break;
        case "prospect":
          cmp = a.company_name.localeCompare(b.company_name);
          break;
        case "rag":
          cmp = (ragOrder[a.rag] || 0) - (ragOrder[b.rag] || 0);
          break;
        case "date":
          cmp = parseCallDate(a.call_date).getTime() - parseCallDate(b.call_date).getTime();
          break;
        case "duration":
          cmp = (a.duration_minutes || 0) - (b.duration_minutes || 0);
          break;
      }
      return cmp * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const repSummaries = useMemo(() => {
    const byRep: Record<string, typeof filtered> = {};
    filtered.forEach((r) => {
      if (!byRep[r.rep_name]) byRep[r.rep_name] = [];
      byRep[r.rep_name].push(r);
    });
    return Object.entries(byRep)
      .filter(([name]) => !activeReps || activeReps.includes(name))
      .map(([name, calls]) => buildRepSummary(name, calls))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [filtered, activeReps]);

  // Aggregate stats
  const avgScore = useMemo(() => {
    if (filtered.length === 0) return 0;
    return Math.round(filtered.reduce((s, r) => s + r.score, 0) / filtered.length);
  }, [filtered]);

  const greenCount = useMemo(() => filtered.filter((r) => r.rag === "green").length, [filtered]);
  const yellowCount = useMemo(() => filtered.filter((r) => r.rag === "yellow").length, [filtered]);
  const redCount = useMemo(() => filtered.filter((r) => r.rag === "red").length, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" || key === "score" ? "desc" : "asc");
    }
    setPage(0);
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="sort-arrow">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>;
  }

  const top3 = useMemo(
    () => [...filtered].sort((a, b) => b.score - a.score).slice(0, 3),
    [filtered]
  );

  const avgRag = avgScore >= 80 ? "g" : avgScore >= 60 ? "y" : "r";

  return (
    <div className="lib-report">
      {/* ── HERO HEADER ── */}
      <div className={`lib-hero lib-hero--${avgRag}`}>
        <div className="lib-hero-glow"></div>
        <div className="lib-hero-grid">
          <div className="lib-hero-info">
            <div className="lib-brand-tag">Killer Calls</div>
            <h1 className="lib-title">{teamName || "Call Library"}</h1>
            <Link href={`${basePath}/settings`} className="lib-settings-link" title="Settings">&#9881; Settings</Link>
            <div className="lib-subtitle">
              {filtered.length} scored call{filtered.length !== 1 ? "s" : ""}
              {period !== "all" && ` in last ${PERIODS.find((p) => p.key === period)?.label?.toLowerCase()}`}
            </div>
          </div>

          <div className="lib-hero-stats">
            <div className="lib-stat">
              <div className={`lib-stat-num lib-stat-num--${avgRag}`}>{avgScore}</div>
              <div className="lib-stat-label">Avg Score</div>
            </div>
            <div className="lib-stat-divider"></div>
            <div className="lib-stat">
              <div className="lib-stat-num lib-stat-num--g">{greenCount}</div>
              <div className="lib-stat-label">Green</div>
            </div>
            <div className="lib-stat">
              <div className="lib-stat-num lib-stat-num--y">{yellowCount}</div>
              <div className="lib-stat-label">Yellow</div>
            </div>
            <div className="lib-stat">
              <div className="lib-stat-num lib-stat-num--r">{redCount}</div>
              <div className="lib-stat-label">Red</div>
            </div>
          </div>

          <div className="lib-hero-filter">
            <div className="period-filter">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  className={`period-btn ${period === p.key ? "active" : ""}`}
                  onClick={() => { setPeriod(p.key); setPage(0); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📞</div>
          <div className="empty-title">No calls in this period</div>
          <div className="empty-text">Try selecting a wider time range.</div>
        </div>
      ) : (
        <>
          {/* ── TOP CALLS ── */}
          {top3.length > 0 && (
            <div className="section">
              <div className="sec-hd">
                <span className="sec-tag">Leaderboard</span>
                <span className="sec-title">Top Calls</span>
              </div>
              <div className="top-grid">
                {top3.map((row, i) => {
                  const rc = ragClass(row.rag);
                  const medals = ["🥇", "🥈", "🥉"];
                  return (
                    <Link
                      href={`${basePath}/calls/${row.id}`}
                      key={row.id}
                      className={`top-card top-card--${rc}`}
                      style={{ animationDelay: `${0.08 * i}s` }}
                    >
                      <div className="top-rank-row">
                        <span className="top-medal">{medals[i]}</span>
                        <span className={`top-score-badge top-score-badge--${rc}`}>
                          {row.score}/100
                        </span>
                      </div>
                      <div className="top-info">
                        <div className={`top-avatar top-avatar--${i}`}>
                          {initials(row.rep_name)}
                        </div>
                        <div>
                          <div className="top-rep">{row.rep_name}</div>
                          <div className="top-company">{row.company_name}</div>
                        </div>
                      </div>
                      <div className="top-verdict">{row.verdict}</div>
                      <div className="top-pips">
                        {(["s", "p", "i", "c", "e"] as const).map((key) => {
                          const status = row[`spiced_${key}` as keyof CallRow] as string;
                          const cls = pipClass(status || "missing");
                          return (
                            <div key={key} className={`top-pip top-pip--${cls}`}>
                              {key.toUpperCase()}
                            </div>
                          );
                        })}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── REP PERFORMANCE ── */}
          {repSummaries.length > 0 && (
            <div className="section">
              <div className="sec-hd">
                <span className="sec-tag">Team</span>
                <span className="sec-title">Rep Performance</span>
              </div>
              <div className="rep-grid">
                {repSummaries.map((rep, i) => (
                  <RepSparkCard key={rep.name} rep={rep} delay={i * 0.04} teamSlug={teamSlug} />
                ))}
              </div>
            </div>
          )}

          {/* ── ALL CALLS TABLE ── */}
          <div className="section">
            <div className="sec-hd">
              <span className="sec-tag">Detail</span>
              <span className="sec-title">All Calls</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="center th-narrow">#</th>
                    <th className={`sortable ${sortKey === "rep" ? "active" : ""}`} onClick={() => toggleSort("rep")}>Rep{sortArrow("rep")}</th>
                    <th className={`sortable ${sortKey === "prospect" ? "active" : ""}`} onClick={() => toggleSort("prospect")}>Prospect{sortArrow("prospect")}</th>
                    <th className={`sortable ${sortKey === "score" ? "active" : ""}`} onClick={() => toggleSort("score")}>Score{sortArrow("score")}</th>
                    <th className={`center sortable ${sortKey === "rag" ? "active" : ""}`} onClick={() => toggleSort("rag")}>Status{sortArrow("rag")}</th>
                    <th className="center">SPICED</th>
                    <th className="center">BANT</th>
                    <th className={`sortable ${sortKey === "date" ? "active" : ""}`} onClick={() => toggleSort("date")}>Date{sortArrow("date")}</th>
                    <th className={`right sortable ${sortKey === "duration" ? "active" : ""}`} onClick={() => toggleSort("duration")}>Duration{sortArrow("duration")}</th>
                    <th className="center th-narrow"></th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, i) => {
                    const rc = ragClass(row.rag);
                    const rank = page * PAGE_SIZE + i + 1;
                    return (
                      <tr
                        key={row.id}
                        style={{ animationDelay: `${0.025 * i}s` }}
                      >
                        <td className="center">
                          <span className={`rank-num ${rank <= 3 ? "rank-top" : ""}`} style={
                            rank === 1 ? { color: "var(--gold)" }
                            : rank === 2 ? { color: "var(--muted)" }
                            : rank === 3 ? { color: "#CD7F32" }
                            : undefined
                          }>
                            {rank}
                          </span>
                        </td>
                        <td>
                          <Link href={`${basePath}/reps/${encodeURIComponent(row.rep_name)}`} className="rep-cell">
                            <div className="avatar">{initials(row.rep_name)}</div>
                            <div className="rep-name">{row.rep_name}</div>
                          </Link>
                        </td>
                        <td>
                          <Link href={`/calls/${row.id}`} className="company-link">
                            {row.company_name}
                            {row.call_type === "followup" && (
                              <span className="followup-badge">Follow-up</span>
                            )}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/calls/${row.id}`} className="score-cell">
                            <div className={`tbl-score ${rc}`}>{row.score}</div>
                            <div className="score-bar-track">
                              <div
                                className={`score-bar-fill score-bar-fill--${rc}`}
                                style={{ width: `${row.score}%` }}
                              ></div>
                            </div>
                          </Link>
                        </td>
                        <td className="center">
                          <span className={`rag-badge rag-badge--${rc}`}>
                            <span className="rag-dot"></span>
                            {ragLabel(row.rag)}
                          </span>
                        </td>
                        <td className="center">
                          <div className="pip-row">
                            {(["s", "p", "i", "c", "e"] as const).map((key) => {
                              const status = row[`spiced_${key}` as keyof CallRow] as string;
                              const cls = pipClass(status || "missing");
                              return (
                                <div key={key} className={`pip pip--${cls}`}>
                                  {key.toUpperCase()}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="center">
                          <div className="pip-row">
                            {(["b", "a", "n", "t"] as const).map((key) => {
                              const status = row[`bant_${key}` as keyof CallRow] as string;
                              const cls = pipClass(status || "missing");
                              return (
                                <div key={key} className={`pip pip--${cls}`}>
                                  {key.toUpperCase()}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td>
                          <span className="date-text">{row.call_date}</span>
                        </td>
                        <td className="right">
                          <span className="duration-text">
                            {row.duration_minutes ? `${row.duration_minutes}m` : "\u2014"}
                          </span>
                        </td>
                        <td className="center">
                          {row.meeting_id && (
                            <a
                              href={`https://app.fireflies.ai/view/${row.meeting_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ff-link"
                            >
                              ▶
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ranked.length > PAGE_SIZE && (
                <div className="pagination">
                  <button
                    className="page-btn"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    &larr; Prev
                  </button>
                  <span className="page-info">
                    {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, ranked.length)} of {ranked.length}
                  </span>
                  <button
                    className="page-btn"
                    disabled={(page + 1) * PAGE_SIZE >= ranked.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
