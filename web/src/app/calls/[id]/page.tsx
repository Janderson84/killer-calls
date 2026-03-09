import { getDb } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import "./call-detail.css";

export default async function CallDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sql = getDb();
  const rows = await sql`
    SELECT s.id, t.slug
    FROM scorecards s
    JOIN teams t ON t.id = s.team_id
    WHERE s.id = ${id}
    LIMIT 1
  `;

  if (rows.length === 0) return notFound();

  redirect(`/t/${rows[0].slug}/calls/${id}`);
}
