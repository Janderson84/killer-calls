"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { CallRow } from "@/app/LibraryClient";
import { buildChartData, buildRepSummary } from "@/lib/chart-utils";

const PAGE_SIZE = 20;

type SortKey = "prospect" | "score" | "rag" | "date" | "duration";
type SortDir = "asc" | "desc";

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

function parseCallDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return new Date(0);
}

const ragOrder: Record<string, number> = { green: 3, yellow: 2, red: 1 };

function ragColor(rag: string): string {
  if (rag === "green") return "var(--green)";
  if (rag === "yellow") return "var(--yellow)";
  return "var(--red)";
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: { rag: string; id: string };
}

function ScatterDot({ cx, cy, payload }: CustomDotProps) {
  if (cx == null || cy == null || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={ragColor(payload.rag)}
      stroke="var(--surface)"
      strokeWidth={2}
      style={{ cursor: "pointer" }}
    />
  );
}

interface TooltipPayloadEntry {
  payload?: {
    company?: string;
    score?: number;
    avg?: number | null;
    rag?: string;
    dateLabel?: string;
  };
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0].payload;
  if (!data) return null;
  const rc = ragClass(data.rag || "red");
  return (
    <div className="rep-chart-tooltip">
      <div className="rep-tooltip-company">{data.company}</div>
      <div className="rep-tooltip-row">
        <span>Score:</span>
        <span className={`rep-tooltip-score ${rc}`}>{data.score}</span>
      </div>
      {data.avg != null && (
        <div className="rep-tooltip-row">
          <span>Avg:</span>
          <span>{data.avg}</span>
        </div>
      )}
      <div className="rep-tooltip-row">
        <span>{data.dateLabel}</span>
      </div>
    </div>
  );
}

export default function RepProfileClient({
  repName,
  rows,
}: {
  repName: string;
  rows: CallRow[];
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "prospect":
          cmp = a.company_name.localeCompare(b.company_name);
          break;
        case "score":
          cmp = a.score - b.score;
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
  }, [rows, sortKey, sortDir]);

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

  const [coachingTips, setCoachingTips] = useState<string[] | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/rep-coaching?rep=${encodeURIComponent(repName)}`)
      .then((res) => res.json())
      .then((data) => setCoachingTips(data.tips || []))
      .catch(() => setCoachingTips(null))
      .finally(() => setCoachingLoading(false));
  }, [repName]);

  const summary = useMemo(() => buildRepSummary(repName, rows), [repName, rows]);
  const chartData = useMemo(() => buildChartData(rows), [rows]);

  const ragDist = useMemo(() => {
    const dist = { green: 0, yellow: 0, red: 0 };
    rows.forEach((r) => {
      if (r.rag === "green") dist.green++;
      else if (r.rag === "yellow") dist.yellow++;
      else dist.red++;
    });
    return dist;
  }, [rows]);

  const avgColor = summary.avgScore >= 80 ? "green" : summary.avgScore >= 60 ? "yellow" : "red";
  const trendClass = summary.trend > 0 ? "up" : summary.trend < 0 ? "down" : "flat";
  const trendArrow = summary.trend > 0 ? "\u2191" : summary.trend < 0 ? "\u2193" : "\u2192";

  function handleDotClick(data: { id?: string }) {
    if (data?.id) {
      router.push(`/calls/${data.id}`);
    }
  }

  return (
    <>
      {/* NAV */}
      <div className="rep-nav">
        <Link href="/">Killer Calls</Link>
        <span className="rep-nav-sep">&rsaquo;</span>
        <span>{repName}</span>
        <span style={{ marginLeft: "auto" }}>
          <Link href="/">&larr; Back to library</Link>
        </span>
      </div>

      <div className="rep-profile">
        {/* HEADER CARD */}
        <div className="rep-header-card">
          <div className="rep-header-left">
            <div className="rep-avatar-lg">{initials(repName)}</div>
            <div>
              <div className="rep-header-name">{repName}</div>
              <div className="rep-header-sub">{summary.totalCalls} calls scored</div>
            </div>
          </div>
          <div className="rep-stats-row">
            <div className="rep-stat">
              <div className={`rep-stat-val ${avgColor}`}>{summary.avgScore}</div>
              <div className="rep-stat-label">Avg Score</div>
            </div>
            <div className="rep-stat">
              <div className={`rep-stat-val blue`}>{summary.totalCalls}</div>
              <div className="rep-stat-label">Total Calls</div>
            </div>
            <div className="rep-stat">
              <div className={`rep-trend ${trendClass}`}>
                {trendArrow} {summary.trend > 0 ? "+" : ""}{summary.trend}
              </div>
              <div className="rep-stat-label">Trend</div>
            </div>
          </div>
        </div>

        {/* COACHING TIPS */}
        {coachingLoading ? (
          <div className="rep-coaching-card">
            <div className="rep-coaching-label">Coaching &middot; Based on last 20 calls</div>
            <div className="rep-coaching-skeleton">
              <div className="rep-coaching-skeleton-line"></div>
              <div className="rep-coaching-skeleton-line short"></div>
            </div>
          </div>
        ) : coachingTips && coachingTips.length > 0 ? (
          <div className="rep-coaching-card">
            <div className="rep-coaching-label">Coaching &middot; Based on last 20 calls</div>
            <ol className="rep-coaching-tips">
              {coachingTips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {/* SCORE HISTORY CHART */}
        <div className="rep-section-label">Score History</div>
        <div className="rep-chart-card">
          <div className="rep-chart-legend">
            <div className="rep-legend-item">
              <div className="rep-legend-dot" style={{ background: "var(--green)" }}></div>
              Green
            </div>
            <div className="rep-legend-item">
              <div className="rep-legend-dot" style={{ background: "var(--yellow)" }}></div>
              Yellow
            </div>
            <div className="rep-legend-item">
              <div className="rep-legend-dot" style={{ background: "var(--red)" }}></div>
              Red
            </div>
            <div className="rep-legend-item">
              <div className="rep-legend-line"></div>
              Rolling Avg
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              onClick={(e: unknown) => {
                const ev = e as { activePayload?: { payload?: { id?: string } }[] };
                if (ev?.activePayload?.[0]?.payload) {
                  handleDotClick(ev.activePayload[0].payload);
                }
              }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: "var(--muted)", fontFamily: "'DM Mono', monospace", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "var(--muted)", fontFamily: "'DM Mono', monospace", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="var(--blue-bright)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Scatter
                dataKey="score"
                shape={<ScatterDot />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RAG DISTRIBUTION */}
        <div className="rep-section-label">RAG Distribution</div>
        <div className="rep-phases-card">
          <div className="rep-phase-row">
            <div className="rep-phase-name">Green</div>
            <div className="rep-phase-bar-wrap">
              <div
                className="rep-phase-bar"
                style={{
                  width: `${rows.length > 0 ? (ragDist.green / rows.length) * 100 : 0}%`,
                  background: "var(--green)",
                }}
              ></div>
            </div>
            <div className="rep-phase-val" style={{ color: "var(--green)" }}>
              {ragDist.green}
            </div>
          </div>
          <div className="rep-phase-row">
            <div className="rep-phase-name">Yellow</div>
            <div className="rep-phase-bar-wrap">
              <div
                className="rep-phase-bar"
                style={{
                  width: `${rows.length > 0 ? (ragDist.yellow / rows.length) * 100 : 0}%`,
                  background: "var(--yellow)",
                }}
              ></div>
            </div>
            <div className="rep-phase-val" style={{ color: "var(--yellow)" }}>
              {ragDist.yellow}
            </div>
          </div>
          <div className="rep-phase-row">
            <div className="rep-phase-name">Red</div>
            <div className="rep-phase-bar-wrap">
              <div
                className="rep-phase-bar"
                style={{
                  width: `${rows.length > 0 ? (ragDist.red / rows.length) * 100 : 0}%`,
                  background: "var(--red)",
                }}
              ></div>
            </div>
            <div className="rep-phase-val" style={{ color: "var(--red)" }}>
              {ragDist.red}
            </div>
          </div>
        </div>

        {/* RECENT CALLS TABLE */}
        <div className="rep-section-label">Recent Calls</div>
        <div className="rep-table-card">
          <table className="rep-table">
            <thead>
              <tr>
                <th className={`sortable ${sortKey === "prospect" ? "active" : ""}`} onClick={() => toggleSort("prospect")}>Prospect{sortArrow("prospect")}</th>
                <th className={`sortable ${sortKey === "score" ? "active" : ""}`} onClick={() => toggleSort("score")}>Score{sortArrow("score")}</th>
                <th className={`center sortable ${sortKey === "rag" ? "active" : ""}`} onClick={() => toggleSort("rag")}>Status{sortArrow("rag")}</th>
                <th className={`sortable ${sortKey === "date" ? "active" : ""}`} onClick={() => toggleSort("date")}>Date{sortArrow("date")}</th>
                <th className={`right sortable ${sortKey === "duration" ? "active" : ""}`} onClick={() => toggleSort("duration")}>Duration{sortArrow("duration")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => {
                const rc = ragClass(row.rag);
                return (
                  <tr key={row.id}>
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
                    <td>
                      <span className="date-text">{row.call_date}</span>
                    </td>
                    <td className="right">
                      <span className="duration-text">
                        {row.duration_minutes ? `${row.duration_minutes}m` : "\u2014"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedRows.length > PAGE_SIZE && (
            <div className="pagination">
              <button
                className="page-btn"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                &larr; Prev
              </button>
              <span className="page-info">
                {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
              </span>
              <button
                className="page-btn"
                disabled={(page + 1) * PAGE_SIZE >= sortedRows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
