import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import AutopsyClient from "./AutopsyClient";

export const dynamic = "force-dynamic";

export default async function AutopsyPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const sql = getDb();

  // Fetch saved autopsies for this rep
  const rows = await sql`
    SELECT id, rep_name, deal_id, deal_title, deal_value,
           call_count, won_avg_score, comparison_calls,
           summary, key_differentiators, patterns_to_replicate,
           coaching_insight, winning_close_style,
           full_analysis, status, generated_at
    FROM autopsies
    WHERE rep_name ILIKE ${decodedName + "%"}
    ORDER BY generated_at DESC
    LIMIT 20
  `;

  // Also fetch live analysis from Railway for fresh results
  let liveAutopsy = null;
  try {
    const railwayUrl = process.env.RAILWAY_API_URL || "https://killer-calls-api-production.up.railway.app";
    const resp = await fetch(`${railwayUrl}/api/deal-autopsy?rep=${encodeURIComponent(decodedName)}&days=90`, {
      signal: AbortSignal.timeout(60000),
    });
    if (resp.ok) {
      liveAutopsy = await resp.json();
    }
  } catch {
    // Live fetch timeout is fine — saved autopsies will still show
  }

  if (rows.length === 0 && !liveAutopsy) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>No autopsies found for {decodedName}</h1>
        <p>Autopsies are generated after each scored demo call. Check back after the next call.</p>
      </div>
    );
  }

  return (
    <AutopsyClient
      repName={decodedName}
      savedAutopsies={rows}
      liveAutopsy={liveAutopsy}
    />
  );
}
