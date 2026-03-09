import { getDb } from "./db";

export interface Team {
  id: string;
  slug: string;
  name: string;
  admin_token: string;
  created_at: string;
}

export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const sql = getDb();
  const rows = await sql`SELECT id, slug, name, admin_token, created_at FROM teams WHERE slug = ${slug} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Team;
}

export async function getAllTeams(): Promise<Team[]> {
  const sql = getDb();
  const rows = await sql`SELECT id, slug, name, admin_token, created_at FROM teams ORDER BY created_at`;
  return rows as unknown as Team[];
}

export async function getTeamById(id: string): Promise<Team | null> {
  const sql = getDb();
  const rows = await sql`SELECT id, slug, name, admin_token, created_at FROM teams WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0] as unknown as Team;
}

export async function createTeam(slug: string, name: string, adminToken: string): Promise<Team> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO teams (slug, name, admin_token)
    VALUES (${slug}, ${name}, ${adminToken})
    RETURNING id, slug, name, admin_token, created_at
  `;
  return rows[0] as unknown as Team;
}
