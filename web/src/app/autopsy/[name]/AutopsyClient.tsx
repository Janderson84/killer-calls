"use client";

import { useState } from "react";

interface Autopsy {
  id: number;
  rep_name: string;
  deal_id: string;
  deal_title: string;
  deal_value: number;
  call_count: number;
  won_avg_score: number;
  comparison_calls: number;
  summary: string;
  key_differentiators: any[];
  patterns_to_replicate: string[];
  coaching_insight: string;
  winning_close_style: string;
  full_analysis: any;
  status: string;
  generated_at: string;
}

interface LiveAutopsy {
  dealsAnalyzed: number;
  autopsies: any[];
}

export default function AutopsyClient({
  repName,
  savedAutopsies,
  liveAutopsy,
}: {
  repName: string;
  savedAutopsies: Autopsy[];
  liveAutopsy: LiveAutopsy | null;
}) {
  const [activeTab, setActiveTab] = useState<"live" | "history">(
    liveAutopsy?.dealsAnalyzed ? "live" : "history"
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.8rem", margin: 0 }}>
          Won-Deal Autopsy: {repName}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <TabButton active={activeTab === "live"} onClick={() => setActiveTab("live")}>
            Live Analysis
          </TabButton>
          <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")}>
            History ({savedAutopsies.length})
          </TabButton>
        </div>
      </div>

      {activeTab === "live" && liveAutopsy ? (
        <LiveView autopsy={liveAutopsy} />
      ) : (
        <HistoryView autopsies={savedAutopsies} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 16px",
        borderRadius: 8,
        border: active ? "2px solid #3b82f6" : "2px solid #e5e7eb",
        background: active ? "#eff6ff" : "white",
        color: active ? "#1d4ed8" : "#6b7280",
        fontWeight: 600,
        cursor: "pointer",
        fontSize: "0.875rem",
      }}
    >
      {children}
    </button>
  );
}

function LiveView({ autopsy }: { autopsy: LiveAutopsy }) {
  return (
    <div>
      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        {autopsy.dealsAnalyzed} won deals analyzed in real-time
      </p>
      {autopsy.autopsies.map((a: any, i: number) => (
        <AutopsyCard key={i} entry={a} isLive />
      ))}
    </div>
  );
}

function HistoryView({ autopsies }: { autopsies: Autopsy[] }) {
  if (autopsies.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#9ca3af" }}>
        <p style={{ fontSize: "1.2rem" }}>No saved autopsies yet</p>
        <p>Run an analysis to see results here</p>
      </div>
    );
  }

  return (
    <div>
      {autopsies.map((a) => (
        <AutopsyCard key={a.id} entry={a} />
      ))}
    </div>
  );
}

function AutopsyCard({
  entry,
  isLive,
}: {
  entry: any;
  isLive?: boolean;
}) {
  const analysis = entry.analysis || entry.full_analysis || entry;
  const summary = entry.summary || analysis?.summary || "";
  const diffs = entry.key_differentiators || analysis?.key_differentiators || [];
  const patterns = entry.patterns_to_replicate || analysis?.patterns_to_replicate || [];
  const insight = entry.coaching_insight || analysis?.coaching_insight || "";
  const close = entry.winning_close_style || analysis?.winning_close_style || "";

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "1.5rem",
        marginBottom: "1rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
            {entry.deal_title || entry.dealTitle || "Deal"}
          </h3>
          <span style={{ color: "#6b7280", fontSize: "0.85rem" }}>
            Deal #{entry.deal_id || entry.dealId}
            {entry.deal_value || entry.dealValue
              ? ` · $${entry.deal_value || entry.dealValue}`
              : ""}
          </span>
        </div>
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 20,
            fontSize: "0.8rem",
            fontWeight: 700,
            background: isLive ? "#dcfce7" : "#f3f4f6",
            color: isLive ? "#166534" : "#6b7280",
          }}
        >
          {isLive ? "LIVE" : "saved"}
        </span>
      </div>

      {summary && (
        <p style={{ fontSize: "0.95rem", lineHeight: 1.6, color: "#374151", marginBottom: "1rem" }}>
          {summary}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <Stat label="Calls" value={entry.call_count || entry.callCount} />
        <Stat label="Avg Score" value={`${entry.won_avg_score || entry.wonAvgScore || "?"}/100`} />
        <Stat
          label="vs Lost"
          value={entry.comparison_calls ?? entry.comparisonCalls ?? 0}
        />
      </div>

      {Array.isArray(diffs) && diffs.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.85rem", color: "#6b7280", margin: "0 0 0.5rem" }}>
            Key Differentiators
          </h4>
          {diffs.slice(0, 3).map((d: any, i: number) => (
            <div
              key={i}
              style={{
                padding: "0.5rem 0.75rem",
                background: "#f9fafb",
                borderRadius: 8,
                marginBottom: "0.35rem",
                fontSize: "0.85rem",
              }}
            >
              <strong>{d.dimension}:</strong> {d.what_worked}
            </div>
          ))}
        </div>
      )}

      {Array.isArray(patterns) && patterns.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.85rem", color: "#6b7280", margin: "0 0 0.5rem" }}>
            Patterns to Replicate
          </h4>
          {patterns.slice(0, 2).map((p: string, i: number) => (
            <div
              key={i}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.85rem",
                color: "#065f46",
              }}
            >
              ★ {p}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          borderTop: "1px solid #f3f4f6",
          paddingTop: "0.75rem",
          display: "grid",
          gap: "0.5rem",
        }}
      >
        {insight && (
          <div style={{ fontSize: "0.85rem" }}>
            <span style={{ color: "#6b7280" }}>Coaching: </span>
            <strong>{insight}</strong>
          </div>
        )}
        {close && (
          <div style={{ fontSize: "0.85rem" }}>
            <span style={{ color: "#6b7280" }}>Close style: </span>
            {close}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "0.5rem",
        background: "#f9fafb",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: "0.7rem", color: "#9ca3af", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#111827" }}>
        {value}
      </div>
    </div>
  );
}
