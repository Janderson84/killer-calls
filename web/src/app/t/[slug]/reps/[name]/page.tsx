import { getDb } from "@/lib/db";
import { getTeamBySlug } from "@/lib/team";
import { notFound } from "next/navigation";
import RepProfileClient from "@/app/reps/[name]/RepProfileClient";
import type { CallRow } from "@/app/LibraryClient";
import "@/app/reps/[name]/rep-profile.css";

export const dynamic = "force-dynamic";

export default async function TeamRepProfilePage({
  params,
}: {
  params: Promise<{ slug: string; name: string }>;
}) {
  const { slug, name } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return notFound();

  const decodedName = decodeURIComponent(name);
  const sql = getDb();

  const rows = (await sql`
    SELECT id, meeting_id, rep_name, company_name, call_date, duration_minutes,
           score, rag, verdict,
           spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
           bant_b, bant_a, bant_n, bant_t,
           COALESCE(call_type, 'discovery') as call_type,
           created_at
    FROM scorecards
    WHERE rep_name = ${decodedName} AND team_id = ${team.id}
    ORDER BY created_at DESC
    LIMIT 100
  `) as unknown as CallRow[];

  if (rows.length === 0) return notFound();

  return <RepProfileClient repName={decodedName} rows={rows} teamSlug={slug} />;
}
