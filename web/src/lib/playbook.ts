import type { Scorecard } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlTaggedTemplate = (...args: any[]) => Promise<any[]>;

export interface PlaybookExample {
  id: string;
  team_id: string;
  scorecard_id: string | null;
  category: string;
  title: string;
  body: string;
  rep_name: string | null;
  company_name: string | null;
  call_date: string | null;
  timestamp: string | null;
  source: "auto" | "manual";
  pinned: boolean;
  metadata: Record<string, unknown> | null;
  search_vector?: unknown;
  created_at: string;
  rank?: number;
}

export interface PlaybookMeta {
  repName: string;
  companyName: string;
  date: string;
  callType: string;
}

export interface ManualExampleData {
  category: string;
  title: string;
  body: string;
  repName?: string;
  companyName?: string;
  timestamp?: string;
}

export interface PlaybookSearchOpts {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
  pinnedOnly?: boolean;
}

export interface PlaybookStat {
  category: string;
  count: number;
}

/**
 * Extract notable examples from a scored call and insert into playbook_examples.
 */
export async function extractPlaybookExamples(
  sql: SqlTaggedTemplate,
  scorecard: Scorecard,
  meta: PlaybookMeta,
  scorecardId: string,
  teamId: string
): Promise<void> {
  // Clear previous auto-extracted examples for this scorecard
  await sql`DELETE FROM playbook_examples WHERE scorecard_id = ${scorecardId} AND source = 'auto'`;

  const inserts: Promise<unknown>[] = [];

  // --- Objection Handling ---
  const ecir = scorecard.phases?.pricing?.criteria?.ecir;
  if (ecir?.objections) {
    for (const obj of ecir.objections) {
      const steps = ["empathize", "clarify", "isolate", "respond"] as const;
      const trueSteps = steps.filter((s) => obj[s]);
      if (trueSteps.length >= 3) {
        const stepsUsed = trueSteps.join(", ");
        const body = `Rep handled "${obj.topic}" objection using ${stepsUsed}. ${ecir.feedback || ""}`.trim();
        inserts.push(
          sql`INSERT INTO playbook_examples
            (team_id, scorecard_id, category, title, body, rep_name, company_name, call_date, timestamp, source, metadata)
            VALUES (${teamId}, ${scorecardId}, 'objection_handling', ${obj.topic}, ${body},
                    ${meta.repName}, ${meta.companyName}, ${meta.date}, ${obj.timestamp || null}, 'auto',
                    ${JSON.stringify(obj)})`
        );
      }
    }
  }

  // --- Close Execution ---
  const close = scorecard.close;
  if (close?.ask?.status === "strong" && close.style !== "none") {
    const title = `${close.styleName || close.style} Close`;
    const parts: string[] = [];
    if (close.setup?.feedback) parts.push(`Setup: ${close.setup.feedback}`);
    if (close.bridge?.feedback) parts.push(`Bridge: ${close.bridge.feedback}`);
    if (close.ask?.feedback) parts.push(`Ask: ${close.ask.feedback}`);
    const body = parts.join("\n");
    const ts = close.ask.timestamps?.[0] || null;

    inserts.push(
      sql`INSERT INTO playbook_examples
        (team_id, scorecard_id, category, title, body, rep_name, company_name, call_date, timestamp, source, metadata)
        VALUES (${teamId}, ${scorecardId}, 'close_execution', ${title}, ${body},
                ${meta.repName}, ${meta.companyName}, ${meta.date}, ${ts}, 'auto',
                ${JSON.stringify(close)})`
    );
  }

  // --- Discovery Wins ---
  if (scorecard.rag === "green" && scorecard.wins) {
    for (const win of scorecard.wins) {
      const title = win.slice(0, 80);
      inserts.push(
        sql`INSERT INTO playbook_examples
          (team_id, scorecard_id, category, title, body, rep_name, company_name, call_date, source)
          VALUES (${teamId}, ${scorecardId}, 'discovery_win', ${title}, ${win},
                  ${meta.repName}, ${meta.companyName}, ${meta.date}, 'auto')`
      );
    }
  }

  // --- Quote of the Call ---
  if (scorecard.rag === "green" && scorecard.quoteOfTheCall?.text) {
    const q = scorecard.quoteOfTheCall;
    const title = q.text.slice(0, 80);
    const body = `"${q.text}" — ${q.context}`;
    inserts.push(
      sql`INSERT INTO playbook_examples
        (team_id, scorecard_id, category, title, body, rep_name, company_name, call_date, timestamp, source)
        VALUES (${teamId}, ${scorecardId}, 'quote', ${title}, ${body},
                ${meta.repName}, ${meta.companyName}, ${meta.date}, ${q.timestamp || null}, 'auto')`
    );
  }

  await Promise.all(inserts);
}

/**
 * Search and filter playbook examples.
 */
export async function searchPlaybook(
  sql: SqlTaggedTemplate,
  teamId: string,
  opts: PlaybookSearchOpts = {}
): Promise<PlaybookExample[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (opts.query) {
    if (opts.category) {
      if (opts.pinnedOnly) {
        const rows = await sql`
          SELECT *, ts_rank(search_vector, plainto_tsquery('english', ${opts.query})) AS rank
          FROM playbook_examples
          WHERE team_id = ${teamId}
            AND category = ${opts.category}
            AND pinned = true
            AND search_vector @@ plainto_tsquery('english', ${opts.query})
          ORDER BY pinned DESC, rank DESC
          LIMIT ${limit} OFFSET ${offset}`;
        return rows as unknown as PlaybookExample[];
      }
      const rows = await sql`
        SELECT *, ts_rank(search_vector, plainto_tsquery('english', ${opts.query})) AS rank
        FROM playbook_examples
        WHERE team_id = ${teamId}
          AND category = ${opts.category}
          AND search_vector @@ plainto_tsquery('english', ${opts.query})
        ORDER BY pinned DESC, rank DESC
        LIMIT ${limit} OFFSET ${offset}`;
      return rows as unknown as PlaybookExample[];
    }
    if (opts.pinnedOnly) {
      const rows = await sql`
        SELECT *, ts_rank(search_vector, plainto_tsquery('english', ${opts.query})) AS rank
        FROM playbook_examples
        WHERE team_id = ${teamId}
          AND pinned = true
          AND search_vector @@ plainto_tsquery('english', ${opts.query})
        ORDER BY pinned DESC, rank DESC
        LIMIT ${limit} OFFSET ${offset}`;
      return rows as unknown as PlaybookExample[];
    }
    const rows = await sql`
      SELECT *, ts_rank(search_vector, plainto_tsquery('english', ${opts.query})) AS rank
      FROM playbook_examples
      WHERE team_id = ${teamId}
        AND search_vector @@ plainto_tsquery('english', ${opts.query})
      ORDER BY pinned DESC, rank DESC
      LIMIT ${limit} OFFSET ${offset}`;
    return rows as unknown as PlaybookExample[];
  }

  // No query — browse mode
  if (opts.category) {
    if (opts.pinnedOnly) {
      const rows = await sql`
        SELECT *, 0 AS rank FROM playbook_examples
        WHERE team_id = ${teamId} AND category = ${opts.category} AND pinned = true
        ORDER BY pinned DESC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}`;
      return rows as unknown as PlaybookExample[];
    }
    const rows = await sql`
      SELECT *, 0 AS rank FROM playbook_examples
      WHERE team_id = ${teamId} AND category = ${opts.category}
      ORDER BY pinned DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    return rows as unknown as PlaybookExample[];
  }
  if (opts.pinnedOnly) {
    const rows = await sql`
      SELECT *, 0 AS rank FROM playbook_examples
      WHERE team_id = ${teamId} AND pinned = true
      ORDER BY pinned DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    return rows as unknown as PlaybookExample[];
  }
  const rows = await sql`
    SELECT *, 0 AS rank FROM playbook_examples
    WHERE team_id = ${teamId}
    ORDER BY pinned DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows as unknown as PlaybookExample[];
}

/**
 * Toggle pin status for a playbook example.
 */
export async function pinExample(
  sql: SqlTaggedTemplate,
  exampleId: string,
  pinned: boolean
): Promise<void> {
  await sql`UPDATE playbook_examples SET pinned = ${pinned} WHERE id = ${exampleId}`;
}

/**
 * Insert a manual playbook entry.
 */
export async function createManualExample(
  sql: SqlTaggedTemplate,
  teamId: string,
  data: ManualExampleData
): Promise<PlaybookExample> {
  const rows = await sql`
    INSERT INTO playbook_examples
      (team_id, scorecard_id, category, title, body, rep_name, company_name, timestamp, source)
    VALUES (${teamId}, ${null}, ${data.category}, ${data.title}, ${data.body},
            ${data.repName || null}, ${data.companyName || null}, ${data.timestamp || null}, 'manual')
    RETURNING *`;
  return rows[0] as unknown as PlaybookExample;
}

/**
 * Delete a playbook example.
 */
export async function deleteExample(
  sql: SqlTaggedTemplate,
  exampleId: string
): Promise<void> {
  await sql`DELETE FROM playbook_examples WHERE id = ${exampleId}`;
}

/**
 * Get counts by category for a team.
 */
export async function getPlaybookStats(
  sql: SqlTaggedTemplate,
  teamId: string
): Promise<PlaybookStat[]> {
  const rows = await sql`
    SELECT category, COUNT(*)::int AS count
    FROM playbook_examples
    WHERE team_id = ${teamId}
    GROUP BY category`;
  return rows as unknown as PlaybookStat[];
}
