import { getDb } from "@/lib/db";
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

  const rows: any[] = await sql`
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

  // Try live fetch
  let liveAutopsy: any = null;
  try {
    const railwayUrl = process.env.RAILWAY_API_URL || "https://killer-calls-api-production.up.railway.app";
    const resp = await fetch(`${railwayUrl}/api/deal-autopsy?rep=${encodeURIComponent(decodedName)}&days=90`, {
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      liveAutopsy = await resp.json();
    }
  } catch {
    // timeout is fine
  }

  return (
    <AutopsyClient
      repName={decodedName}
      savedAutopsies={rows}
      liveAutopsy={liveAutopsy}
    />
  );
}
