import { NextResponse } from "next/server";
import { createTeam } from "@/lib/team";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.replace("Bearer ", "");
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.name?.trim() || !body.slug?.trim()) {
    return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
  }

  const slug = body.slug.trim();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, numbers, and hyphens only" }, { status: 400 });
  }

  const adminToken = crypto.randomUUID();

  let team;
  try {
    team = await createTeam(slug, body.name.trim(), adminToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("already exists")) {
      return NextResponse.json({ error: "A team with this slug already exists" }, { status: 409 });
    }
    throw err;
  }

  // Upsert settings
  const settings = body.settings as Record<string, unknown> | undefined;
  let settingsCount = 0;
  if (settings && typeof settings === "object") {
    const sql = getDb();
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined || value === null || value === "") continue;
      await sql`
        INSERT INTO settings (team_id, key, value, updated_at)
        VALUES (${team.id}, ${key}, ${JSON.stringify(value)}::jsonb, now())
        ON CONFLICT (team_id, key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb, updated_at = now()
      `;
      settingsCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    team: { id: team.id, slug: team.slug, name: team.name, admin_token: adminToken },
    settingsCount,
  });
}
