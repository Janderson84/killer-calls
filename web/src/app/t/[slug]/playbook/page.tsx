import { getDb } from "@/lib/db";
import { getTeamBySlug } from "@/lib/team";
import { notFound } from "next/navigation";
import PlaybookClient from "./PlaybookClient";
import "./playbook.css";

export const dynamic = "force-dynamic";

export default async function PlaybookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) return notFound();

  const sp = await searchParams;
  const q = sp.q || "";
  const category = sp.category || "";
  const page = Math.max(1, parseInt(sp.page || "1", 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  const sql = getDb();

  let examplesQuery;
  let countQuery;

  if (q && category) {
    examplesQuery = sql`
      SELECT id, category, title, body, rep_name, company_name, call_date,
             timestamp, scorecard_id, pinned, source, metadata, created_at
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND search_vector @@ plainto_tsquery('english', ${q})
        AND category = ${category}
      ORDER BY pinned DESC, ts_rank(search_vector, plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    countQuery = sql`
      SELECT COUNT(*)::int as total
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND search_vector @@ plainto_tsquery('english', ${q})
        AND category = ${category}
    `;
  } else if (q) {
    examplesQuery = sql`
      SELECT id, category, title, body, rep_name, company_name, call_date,
             timestamp, scorecard_id, pinned, source, metadata, created_at
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND search_vector @@ plainto_tsquery('english', ${q})
      ORDER BY pinned DESC, ts_rank(search_vector, plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    countQuery = sql`
      SELECT COUNT(*)::int as total
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND search_vector @@ plainto_tsquery('english', ${q})
    `;
  } else if (category) {
    examplesQuery = sql`
      SELECT id, category, title, body, rep_name, company_name, call_date,
             timestamp, scorecard_id, pinned, source, metadata, created_at
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND category = ${category}
      ORDER BY pinned DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    countQuery = sql`
      SELECT COUNT(*)::int as total
      FROM playbook_examples
      WHERE team_id = ${team.id}
        AND category = ${category}
    `;
  } else {
    examplesQuery = sql`
      SELECT id, category, title, body, rep_name, company_name, call_date,
             timestamp, scorecard_id, pinned, source, metadata, created_at
      FROM playbook_examples
      WHERE team_id = ${team.id}
      ORDER BY pinned DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    countQuery = sql`
      SELECT COUNT(*)::int as total
      FROM playbook_examples
      WHERE team_id = ${team.id}
    `;
  }

  const statsQuery = sql`
    SELECT category, COUNT(*)::int as count
    FROM playbook_examples
    WHERE team_id = ${team.id}
    GROUP BY category
  `;

  const [examples, countResult, stats] = await Promise.all([
    examplesQuery,
    countQuery,
    statsQuery,
  ]);

  const total = countResult[0]?.total ?? 0;

  return (
    <PlaybookClient
      examples={examples as any[]}
      stats={stats as any[]}
      team={{ id: team.id, slug: team.slug, name: team.name }}
      query={q}
      category={category}
      total={total}
    />
  );
}
