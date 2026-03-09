import { getDb } from "@/lib/db";
import { getAllTeams } from "@/lib/team";
import Link from "next/link";
import "./library.css";

export const dynamic = "force-dynamic";

interface TeamStats {
  team_id: string;
  call_count: number;
  avg_score: number;
  rep_count: number;
  green_count: number;
  yellow_count: number;
  red_count: number;
}

export default async function SuperAdminPage() {
  const sql = getDb();
  const [teams, statsRows] = await Promise.all([
    getAllTeams(),
    sql`
      SELECT
        team_id,
        COUNT(*)::int as call_count,
        ROUND(AVG(score))::int as avg_score,
        COUNT(DISTINCT rep_name)::int as rep_count,
        COUNT(*) FILTER (WHERE rag = 'green')::int as green_count,
        COUNT(*) FILTER (WHERE rag = 'yellow')::int as yellow_count,
        COUNT(*) FILTER (WHERE rag = 'red')::int as red_count
      FROM scorecards
      GROUP BY team_id
    `,
  ]);

  const statsMap: Record<string, TeamStats> = {};
  for (const row of statsRows) {
    statsMap[row.team_id as string] = row as unknown as TeamStats;
  }

  return (
    <div className="lib-report">
      <div className="lib-hero lib-hero--g">
        <div className="lib-hero-glow"></div>
        <div className="lib-hero-grid">
          <div className="lib-hero-info">
            <div className="lib-brand-tag">Killer Calls</div>
            <h1 className="lib-title">All Teams</h1>
            <div className="lib-subtitle">
              {teams.length} team{teams.length !== 1 ? "s" : ""}
            </div>
          </div>
          <div className="lib-hero-stats">
            <div className="lib-stat">
              <div className="lib-stat-num lib-stat-num--g">{teams.length}</div>
              <div className="lib-stat-label">Teams</div>
            </div>
            <div className="lib-stat-divider"></div>
            <div className="lib-stat">
              <div className="lib-stat-num lib-stat-num--g">
                {Object.values(statsMap).reduce((s, t) => s + t.call_count, 0)}
              </div>
              <div className="lib-stat-label">Total Calls</div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="sec-hd">
          <span className="sec-tag">Overview</span>
          <span className="sec-title">Teams</span>
        </div>
        <div className="top-grid">
          {teams.map((team, i) => {
            const stats = statsMap[team.id];
            const calls = stats?.call_count ?? 0;
            const avg = stats?.avg_score ?? 0;
            const reps = stats?.rep_count ?? 0;
            const rc = avg >= 80 ? "g" : avg >= 60 ? "y" : "r";

            return (
              <Link
                href={`/t/${team.slug}`}
                key={team.id}
                className={`top-card top-card--${rc}`}
                style={{ animationDelay: `${0.08 * i}s` }}
              >
                <div className="top-rank-row">
                  <span className="top-medal" style={{ fontSize: "1.2rem" }}>
                    {team.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className={`top-score-badge top-score-badge--${rc}`}>
                    {avg}/100 avg
                  </span>
                </div>
                <div className="top-info">
                  <div>
                    <div className="top-rep">{team.name}</div>
                    <div className="top-company">/t/{team.slug}</div>
                  </div>
                </div>
                <div className="top-verdict">
                  {calls} calls &middot; {reps} reps
                </div>
                <div className="top-pips">
                  <div className="top-pip top-pip--g">{stats?.green_count ?? 0} G</div>
                  <div className="top-pip top-pip--y">{stats?.yellow_count ?? 0} Y</div>
                  <div className="top-pip top-pip--r">{stats?.red_count ?? 0} R</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
