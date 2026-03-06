import { getDb } from "@/lib/db";
import LibraryClient, { CallRow } from "./LibraryClient";
import "./library.css";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, meeting_id, rep_name, company_name, call_date, duration_minutes,
           score, rag, verdict,
           spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
           bant_b, bant_a, bant_n, bant_t,
           COALESCE(call_type, 'discovery') as call_type,
           created_at
    FROM scorecards
    ORDER BY created_at DESC
    LIMIT 200
  `) as unknown as CallRow[];

  return <LibraryClient rows={rows} />;
}
