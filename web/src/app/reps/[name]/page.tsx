import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import RepProfileClient from "./RepProfileClient";
import type { CallRow } from "@/app/LibraryClient";
import "./rep-profile.css";

export const dynamic = "force-dynamic";

export default async function RepProfilePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const sql = getDb();

  const rows = (await sql`
    SELECT id, meeting_id, rep_name, company_name, call_date, duration_minutes,
           score, rag, verdict,
           spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
           bant_b, bant_a, bant_n, bant_t,
           created_at
    FROM scorecards
    WHERE rep_name = ${decodedName}
    ORDER BY created_at DESC
    LIMIT 100
  `) as unknown as CallRow[];

  if (rows.length === 0) return notFound();

  return <RepProfileClient repName={decodedName} rows={rows} />;
}
