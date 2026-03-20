import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import Anthropic from "@anthropic-ai/sdk";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rep = searchParams.get("rep");
  if (!rep) {
    return NextResponse.json({ error: "Missing rep param" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // 1. Fetch last 20 scorecards
    const rows = await sql`
      SELECT scorecard_json FROM scorecards
      WHERE rep_name = ${rep}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    if (rows.length === 0) {
      return NextResponse.json({ tips: [] });
    }

    // 2. Extract patterns from scorecards
    const scorecards = rows.map((r) => {
      const sc = typeof r.scorecard_json === "string"
        ? JSON.parse(r.scorecard_json)
        : r.scorecard_json;
      return sc;
    });

    const scores = scorecards.map((sc) => sc.score as number).filter(Boolean);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Trend: compare first half vs second half
    const half = Math.floor(scores.length / 2);
    const recentHalf = scores.slice(0, half);
    const olderHalf = scores.slice(half);
    const recentAvg = recentHalf.length > 0
      ? recentHalf.reduce((a, b) => a + b, 0) / recentHalf.length
      : 0;
    const olderAvg = olderHalf.length > 0
      ? olderHalf.reduce((a, b) => a + b, 0) / olderHalf.length
      : 0;
    const trend = recentAvg > olderAvg ? "improving" : recentAvg < olderAvg ? "declining" : "flat";

    // Phase scores
    const phaseNames = ["preCall", "discovery", "presentation", "pricing", "closing"] as const;
    const phaseMaxes: Record<string, number> = {
      preCall: 6, discovery: 32, presentation: 22, pricing: 28, closing: 12,
    };
    const phaseAvgs: string[] = [];
    for (const phase of phaseNames) {
      const phaseScores = scorecards
        .map((sc) => sc.phases?.[phase]?.score as number)
        .filter((s) => s != null);
      if (phaseScores.length > 0) {
        const avg = phaseScores.reduce((a, b) => a + b, 0) / phaseScores.length;
        const pct = Math.round((avg / phaseMaxes[phase]) * 100);
        phaseAvgs.push(`${phase}: ${pct}%`);
      }
    }

    // SPICED hit rates
    const spicedElements = ["s", "p", "i", "c", "e"] as const;
    const spicedLabels: Record<string, string> = {
      s: "Situation", p: "Pain", i: "Impact", c: "Critical Event", e: "Decision",
    };
    const spicedLines: string[] = [];
    for (const el of spicedElements) {
      const statuses = scorecards
        .map((sc) => sc.spiced?.[el]?.status as string)
        .filter(Boolean);
      const missing = statuses.filter((s) => s === "missing").length;
      const partial = statuses.filter((s) => s === "partial").length;
      if (missing + partial > statuses.length * 0.3) {
        spicedLines.push(
          `${spicedLabels[el]}: missing in ${missing}/${statuses.length}, partial in ${partial}/${statuses.length}`
        );
      }
    }

    // BANT gaps
    const bantElements = ["b", "a", "n", "t"] as const;
    const bantLabels: Record<string, string> = {
      b: "Budget", a: "Authority", n: "Need", t: "Timeline",
    };
    const bantLines: string[] = [];
    for (const el of bantElements) {
      const statuses = scorecards
        .map((sc) => sc.bant?.[el]?.status as string)
        .filter(Boolean);
      const missing = statuses.filter((s) => s === "missing").length;
      if (missing > statuses.length * 0.3) {
        bantLines.push(`${bantLabels[el]}: missing in ${missing}/${statuses.length}`);
      }
    }

    // Close patterns
    const closeStyles = scorecards
      .map((sc) => sc.close?.style as string)
      .filter(Boolean);
    const styleCount: Record<string, number> = {};
    closeStyles.forEach((s) => { styleCount[s] = (styleCount[s] || 0) + 1; });
    const closeSteps = ["setup", "bridge", "ask"] as const;
    const closeWeaknesses: string[] = [];
    for (const step of closeSteps) {
      const statuses = scorecards
        .map((sc) => sc.close?.[step]?.status as string)
        .filter(Boolean);
      const weak = statuses.filter((s) => s === "missing" || s === "partial").length;
      if (weak > statuses.length * 0.4) {
        closeWeaknesses.push(`${step}: weak/missing in ${weak}/${statuses.length}`);
      }
    }

    // Recurring fixes
    const allFixes = scorecards.flatMap((sc) => (sc.fixes as string[]) || []);
    const fixCount: Record<string, number> = {};
    allFixes.forEach((f) => {
      const key = f.toLowerCase().slice(0, 80);
      fixCount[key] = (fixCount[key] || 0) + 1;
    });
    const topFixes = Object.entries(fixCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([fix, count]) => `"${fix}" (${count}x)`);

    // 3. Build summary for Claude
    const summary = [
      `Rep: ${rep}`,
      `Calls analyzed: ${scorecards.length}`,
      `Avg score: ${avgScore}/100, trend: ${trend}`,
      `Phase averages: ${phaseAvgs.join(", ")}`,
      spicedLines.length > 0 ? `SPICED gaps: ${spicedLines.join("; ")}` : "SPICED: generally covered",
      bantLines.length > 0 ? `BANT gaps: ${bantLines.join("; ")}` : "BANT: generally covered",
      `Close styles used: ${Object.entries(styleCount).map(([s, c]) => `${s}(${c})`).join(", ") || "varied"}`,
      closeWeaknesses.length > 0 ? `Close weaknesses: ${closeWeaknesses.join("; ")}` : "Close execution: generally solid",
      topFixes.length > 0 ? `Recurring fixes: ${topFixes.join("; ")}` : "",
    ].filter(Boolean).join("\n");

    // 4. Call Claude
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Based on these patterns across ${scorecards.length} sales calls, give 1-3 short, actionable coaching tips for this rep's very next call. Each tip: 1-2 sentences max. Be specific to their patterns, not generic. Reference the specific gaps you see.\n\nIMPORTANT: Output ONLY the numbered tips (1. 2. 3.) — no headers, no intro, no outro.\n\n${summary}`,
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse numbered tips from response — strip headers, bold markers, empty lines
    const tips = text
      .split(/\n/)
      .filter((line) => !line.match(/^#{1,4}\s/) && !line.match(/^\*\*[^*]+\*\*\s*$/))
      .map((line) => line.replace(/^\d+[\.\)]\s*/, "").replace(/^\*\*(.+?)\*\*:?\s*/, "$1: ").trim())
      .filter((line) => line.length > 10);

    return NextResponse.json({ tips: tips.slice(0, 3) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("rep-coaching error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
