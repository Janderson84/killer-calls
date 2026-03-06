export interface ChartPoint {
  date: string;       // ISO date string for x-axis
  dateLabel: string;  // Formatted label like "Feb 26"
  score: number;
  avg: number | null; // Rolling 5-call average (null if < 2 data points)
  company: string;
  rag: string;        // "green" | "yellow" | "red"
  id: string;         // scorecard id for click-through
}

export interface RepSummary {
  name: string;
  totalCalls: number;
  avgScore: number;
  trend: number;        // delta between last 5 avg and prior 5 avg
  latestRag: string;
  chartData: ChartPoint[];
}

interface CallInput {
  id: string;
  score: number;
  rag: string;
  company_name: string;
  call_date: string;
  created_at: string;
}

function parseDate(dateStr: string): Date {
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return new Date(0);
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ROLLING_WINDOW = 5;

export function buildChartData(calls: CallInput[]): ChartPoint[] {
  // Sort chronologically (oldest first)
  const sorted = [...calls].sort(
    (a, b) => parseDate(a.created_at).getTime() - parseDate(b.created_at).getTime()
  );

  return sorted.map((call, i) => {
    // Compute rolling average over the last ROLLING_WINDOW calls (including this one)
    const windowStart = Math.max(0, i - ROLLING_WINDOW + 1);
    const window = sorted.slice(windowStart, i + 1);
    const avgScore = window.reduce((sum, c) => sum + c.score, 0) / window.length;

    const d = parseDate(call.created_at);

    return {
      date: d.toISOString(),
      dateLabel: formatDateLabel(d),
      score: call.score,
      avg: i >= 1 ? Math.round(avgScore * 10) / 10 : null, // Need at least 2 points for avg line
      company: call.company_name,
      rag: call.rag,
      id: call.id,
    };
  });
}

export function buildRepSummary(name: string, calls: CallInput[]): RepSummary {
  if (calls.length === 0) {
    return { name, totalCalls: 0, avgScore: 0, trend: 0, latestRag: "red", chartData: [] };
  }

  const chartData = buildChartData(calls);
  const avgScore = Math.round(calls.reduce((s, c) => s + c.score, 0) / calls.length);

  // Trend: compare last 5 avg vs prior 5 avg
  const sorted = [...calls].sort(
    (a, b) => parseDate(b.created_at).getTime() - parseDate(a.created_at).getTime()
  );
  const recent5 = sorted.slice(0, Math.min(5, sorted.length));
  const prior5 = sorted.slice(5, Math.min(10, sorted.length));

  const recentAvg = recent5.reduce((s, c) => s + c.score, 0) / recent5.length;
  const priorAvg = prior5.length > 0
    ? prior5.reduce((s, c) => s + c.score, 0) / prior5.length
    : recentAvg;

  const trend = Math.round((recentAvg - priorAvg) * 10) / 10;
  const latestRag = sorted[0].rag;

  return { name, totalCalls: calls.length, avgScore, trend, latestRag, chartData };
}
