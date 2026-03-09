import { getDb } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import "./rep-profile.css";

export const dynamic = "force-dynamic";

export default async function RepProfileRedirect({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const sql = getDb();

  // Find which team this rep belongs to
  const rows = await sql`
    SELECT t.slug
    FROM scorecards s
    JOIN teams t ON t.id = s.team_id
    WHERE s.rep_name = ${decodedName}
    LIMIT 1
  `;

  if (rows.length === 0) return notFound();

  redirect(`/t/${rows[0].slug}/reps/${encodeURIComponent(decodedName)}`);
}
