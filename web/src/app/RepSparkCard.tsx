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

export default function RepSparkCard({ rep }: { rep: RepSummary }) {
  const trendClass = rep.trend > 0 ? "up" : rep.trend < 0 ? "down" : "flat";
  const trendArrow = rep.trend > 0 ? "\u2191" : rep.trend < 0 ? "\u2193" : "\u2192";
  const avgColor = rep.avgScore >= 80 ? "var(--green)" : rep.avgScore >= 60 ? "var(--yellow)" : "var(--red)";

  const hasEnoughData = rep.chartData.length >= 3;
  const sparkData = rep.chartData.map((d) => ({ score: d.score }));

  return (
    <Link
      href={`/reps/${encodeURIComponent(rep.name)}`}
      className="rep-spark-card"
    >
      <div className="spark-header">
        <div className="spark-avatar">{initials(rep.name)}</div>
        <div className="spark-info">
          <div className="spark-name">{rep.name}</div>
          <div className="spark-meta">{rep.totalCalls} calls</div>
        </div>
      </div>
      <div className="spark-stats">
        <div className="spark-avg" style={{ color: avgColor }}>{rep.avgScore}</div>
        <div className={`spark-trend ${trendClass}`}>
          {trendArrow}{rep.trend > 0 ? "+" : ""}{rep.trend}
        </div>
      </div>
      <div className="spark-chart">
        {hasEnoughData ? (
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={sparkData}>
              <Line
                type="monotone"
                dataKey="score"
                stroke="var(--blue-bright)"
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
