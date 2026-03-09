"use client";

import Link from "next/link";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { RepSummary } from "@/lib/chart-utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function RepSparkCard({ rep, delay = 0, teamSlug }: { rep: RepSummary; delay?: number; teamSlug?: string }) {
  const basePath = teamSlug ? `/t/${teamSlug}` : "";
  const trendClass = rep.trend > 0 ? "up" : rep.trend < 0 ? "down" : "flat";
  const trendArrow = rep.trend > 0 ? "\u2191" : rep.trend < 0 ? "\u2193" : "";
  const avgColor = rep.avgScore >= 80 ? "g" : rep.avgScore >= 60 ? "y" : "r";

  const hasEnoughData = rep.chartData.length >= 3;
  const sparkData = rep.chartData.map((d) => ({ score: d.score }));

  return (
    <Link
      href={`${basePath}/reps/${encodeURIComponent(rep.name)}`}
      className={`spark-card spark-card--${avgColor}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="spark-hd">
        <div className="spark-avatar">{initials(rep.name)}</div>
        <div className="spark-info">
          <div className="spark-name">{rep.name}</div>
          <div className="spark-meta">{rep.totalCalls} call{rep.totalCalls !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <div className="spark-stats">
        <div className={`spark-avg spark-avg--${avgColor}`}>{rep.avgScore}</div>
        {rep.trend !== 0 && (
          <div className={`spark-trend spark-trend--${trendClass}`}>
            {trendArrow}{rep.trend > 0 ? "+" : ""}{rep.trend}
          </div>
        )}
      </div>
      <div className="spark-chart">
        {hasEnoughData ? (
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={sparkData}>
              <Line
                type="monotone"
                dataKey="score"
                stroke={avgColor === "g" ? "var(--green)" : avgColor === "y" ? "var(--yellow)" : "var(--red)"}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="spark-placeholder">Not enough data</div>
        )}
      </div>
    </Link>
  );
}
