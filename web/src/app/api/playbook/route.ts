import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function checkAuth(request: Request, teamId?: string): Promise<boolean> {
  const auth = request.headers.get("authorization");
  const token = auth?.replace("Bearer ", "");
  if (!token) return false;
  if (token === process.env.CRON_SECRET) return true;

  if (teamId) {
    const sql = getDb();
    const rows = await sql`SELECT admin_token FROM teams WHERE id = ${teamId} LIMIT 1`;
    if (rows.length > 0 && rows[0].admin_token === token) return true;
  }

  return false;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.teamId || !body.category || !body.title || !body.body) {
    return NextResponse.json(
      { error: "Missing required fields: teamId, category, title, body" },
      { status: 400 }
    );
  }

  if (!(await checkAuth(request, body.teamId))) return unauthorized();

  const sql = getDb();

  await sql`
    INSERT INTO playbook_examples (team_id, category, title, body, rep_name, company_name, timestamp, source)
    VALUES (
      ${body.teamId},
      ${body.category},
      ${body.title},
      ${body.body},
      ${body.repName || null},
      ${body.companyName || null},
      ${body.timestamp || null},
      'manual'
    )
  `;

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.id || typeof body.pinned !== "boolean") {
    return NextResponse.json(
      { error: "Missing required fields: id, pinned" },
      { status: 400 }
    );
  }

  // Look up the example's team_id for auth
  const sql = getDb();
  const rows = await sql`SELECT team_id FROM playbook_examples WHERE id = ${body.id} LIMIT 1`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const teamId = rows[0].team_id as string;
  if (!(await checkAuth(request, teamId))) return unauthorized();

  await sql`
    UPDATE playbook_examples SET pinned = ${body.pinned} WHERE id = ${body.id}
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.id) {
    return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
  }

  // Look up the example's team_id for auth
  const sql = getDb();
  const rows = await sql`SELECT team_id FROM playbook_examples WHERE id = ${body.id} LIMIT 1`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const teamId = rows[0].team_id as string;
  if (!(await checkAuth(request, teamId))) return unauthorized();

  await sql`DELETE FROM playbook_examples WHERE id = ${body.id}`;

  return NextResponse.json({ ok: true });
}
