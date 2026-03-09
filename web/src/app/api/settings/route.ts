import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function checkAuth(request: Request, teamAdminToken?: string): boolean {
  const auth = request.headers.get("authorization");
  const token = auth?.replace("Bearer ", "");
  if (!token) return false;
  // Accept CRON_SECRET (super-admin) or team admin_token
  if (token === process.env.CRON_SECRET) return true;
  if (teamAdminToken && token === teamAdminToken) return true;
  return false;
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.replace("Bearer ", "");
  if (token !== process.env.CRON_SECRET) return unauthorized();

  const sql = getDb();
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");

  if (teamId) {
    const rows = await sql`SELECT key, value, updated_at FROM settings WHERE team_id = ${teamId} ORDER BY key`;
    return NextResponse.json({ settings: rows });
  }

  const rows = await sql`SELECT key, value, updated_at, team_id FROM settings ORDER BY key`;
  return NextResponse.json({ settings: rows });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.value === undefined || !body.teamId) {
    return NextResponse.json({ error: "Missing key, value, or teamId" }, { status: 400 });
  }

  const sql = getDb();

  // Look up team admin_token for auth check
  const teamRows = await sql`SELECT admin_token FROM teams WHERE id = ${body.teamId} LIMIT 1`;
  const teamAdminToken = teamRows.length > 0 ? (teamRows[0].admin_token as string) : undefined;

  if (!checkAuth(request, teamAdminToken)) return unauthorized();

  await sql`
    INSERT INTO settings (team_id, key, value, updated_at)
    VALUES (${body.teamId}, ${body.key}, ${JSON.stringify(body.value)}::jsonb, now())
    ON CONFLICT (team_id, key) DO UPDATE SET value = ${JSON.stringify(body.value)}::jsonb, updated_at = now()
  `;

  return NextResponse.json({ ok: true, key: body.key });
}
