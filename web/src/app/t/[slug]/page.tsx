import { getDb } from "@/lib/db";
import { getTeamBySlug } from "@/lib/team";
import { getSetting } from "@/lib/settings";
import { notFound } from "next/navigation";
import LibraryClient, { CallRow } from "@/app/LibraryClient";
import "@/app/library.css";

export const dynamic = "force-dynamic";

export default async function TeamLibraryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return notFound();

  const sql = getDb();
  const [rows, roster, teamGoals] = await Promise.all([
    sql`
      SELECT id, meeting_id, rep_name, company_name, call_date, duration_minutes,
             score, rag, verdict,
             spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
             bant_b, bant_a, bant_n, bant_t,
             COALESCE(call_type, 'discovery') as call_type,
             created_at,
             score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
             close_style, close_setup, close_bridge, close_ask
      FROM scorecards
      WHERE team_id = ${team.id}
      ORDER BY created_at DESC
      LIMIT 200
    `,
    getSetting(team.id, "ae_roster"),
    getSetting(team.id, "team_goals"),
  ]);

  const activeRepNames = roster ? roster.map((ae) => ae.name) : null;

  return (
    <LibraryClient
      rows={rows as unknown as CallRow[]}
      activeReps={activeRepNames}
      teamSlug={slug}
      teamName={team.name}
      teamGoals={teamGoals as { targetAvgScore: number; targetGreenPct: number } | null}
    />
  );
}
