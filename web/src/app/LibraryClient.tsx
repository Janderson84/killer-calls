"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

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
  created_at: string;
}

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
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
  // call_date is like "Feb 26, 2026"
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

function ordinalSuffix(n: number): string {
  if (n === 1) return "st";
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return "th";
}

export default function LibraryClient({ rows }: { rows: CallRow[] }) {
  const [period, setPeriod] = useState<Period>("all");

  const filtered = useMemo(() => {
    if (period === "all") return rows;
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    const cutoff = daysAgo(days);
    return rows.filter((r) => parseCallDate(r.call_date) >= cutoff);
  }, [rows, period]);

  // Sort by score descending for rankings
  const ranked = useMemo(
    () => [...filtered].sort((a, b) => b.score - a.score),
    [filtered]
  );

  const top3 = ranked.slice(0, 3);
  const podiumColors = ["var(--gold)", "var(--muted)", "#CD7F32"];
  const podiumBgs = [
    "var(--gold-bg)",
    "rgba(90,106,133,0.08)",
    "rgba(205,127,50,0.08)",
  ];
  const podiumBorders = [
    "var(--gold-border)",
    "rgba(90,106,133,0.2)",
    "rgba(205,127,50,0.2)",
  ];

  return (
    <div className="library-page">
      <div className="lib-header">
        <div className="lib-header-left">
          <div className="lib-brand">Killer Calls</div>
          <div className="lib-title">Call Library</div>
          <div className="lib-subtitle">
            {filtered.length} scored call{filtered.length !== 1 ? "s" : ""}
            {period !== "all" && ` in ${PERIODS.find((p) => p.key === period)?.label?.toLowerCase()}`}
          </div>
        </div>
        <div className="period-filter">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`period-btn ${period === p.key ? "active" : ""}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divider-line"></div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📞</div>
          <div className="empty-title">No calls in this period</div>
          <div className="empty-text">
            Try selecting a wider time range.
          </div>
        </div>
      ) : (
        <>
          {/* TOP CALLS */}
          {top3.length > 0 && (
            <div className="top-calls">
              <div className="top-calls-label">Top Calls</div>
              <div className="top-calls-grid">
                {top3.map((row, i) => {
                  const rc = ragClass(row.rag);
                  return (
                    <Link
                      href={`/calls/${row.id}`}
                      key={row.id}
                      className="top-card"
                      style={{
                        borderColor: podiumBorders[i],
                        background: podiumBgs[i],
                        animationDelay: `${0.1 * i}s`,
                      }}
                    >
                      <div className="top-rank" style={{ color: podiumColors[i] }}>
                        #{i + 1}
                      </div>
                      <div className="top-info">
                        <div className="top-avatar" style={{
                          background: i === 0
                            ? "linear-gradient(135deg, #b45309, #f59e0b)"
                            : i === 1
                            ? "linear-gradient(135deg, #475569, #94a3b8)"
                            : "linear-gradient(135deg, #92400e, #cd7f32)",
                        }}>
                          {initials(row.rep_name)}
                        </div>
                        <div>
                          <div className="top-rep">{row.rep_name}</div>
                          <div className="top-company">{row.company_name}</div>
                        </div>
                      </div>
                      <div className="top-score-row">
                        <div className={`top-score ${rc}`}>{row.score}<span>/100</span></div>
                        <span className={`rag ${rc}`}>
                          <span className="rag-dot"></span>
                          {ragLabel(row.rag)}
                        </span>
                      </div>
                      <div className="top-verdict">{row.verdict}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* RANKED TABLE */}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th className="center">#</th>
                  <th>Rep</th>
                  <th>Prospect</th>
                  <th>Score</th>
                  <th className="center">Status</th>
                  <th className="center">SPICED</th>
                  <th className="center">BANT</th>
                  <th>Date</th>
                  <th className="right">Duration</th>
                  <th className="center"></th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row, i) => {
                  const rc = ragClass(row.rag);
                  const rank = i + 1;
                  return (
                    <tr
                      key={row.id}
                      className={rank <= 3 ? "top-row" : ""}
                      style={{ animationDelay: `${0.03 * i}s` }}
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
                        <Link href={`/calls/${row.id}`} className="rep-cell">
                          <div className="avatar">{initials(row.rep_name)}</div>
                          <div className="rep-name">{row.rep_name}</div>
                        </Link>
                      </td>
                      <td>
                        <Link href={`/calls/${row.id}`} className="company-link">
                          {row.company_name}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/calls/${row.id}`} className="score-cell">
                          <div className={`score-num ${rc}`}>{row.score}</div>
                          <div className="score-bar-wrap">
                            <div
                              className={`score-bar ${rc}`}
                              style={{ width: `${row.score}%` }}
                            ></div>
                          </div>
                        </Link>
                      </td>
                      <td className="center">
                        <span className={`rag ${rc}`}>
                          <span className="rag-dot"></span>
                          {ragLabel(row.rag)}
                        </span>
                      </td>
                      <td className="center">
                        <div className="spiced-mini">
                          {(["s", "p", "i", "c", "e"] as const).map((key) => {
                            const status = row[`spiced_${key}` as keyof CallRow] as string;
                            const cls = pipClass(status || "missing");
                            return (
                              <div key={key} className={`spiced-pip ${cls}`}>
                                {key.toUpperCase()}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="center">
                        <div className="bant-mini">
                          {(["b", "a", "n", "t"] as const).map((key) => {
                            const status = row[`bant_${key}` as keyof CallRow] as string;
                            const cls = pipClass(status || "missing");
                            return (
                              <div key={key} className={`bant-pip ${cls}`}>
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
          </div>
        </>
      )}
    </div>
  );
}
