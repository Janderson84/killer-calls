import { getDb } from "@/lib/db";
import { getAllTeams } from "@/lib/team";
import Link from "next/link";
import "./admin.css";

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

interface TeamGoals {
  targetAvgScore: number;
  targetGreenPct: number;
}

export default async function SuperAdminPage() {
  const sql = getDb();
  const [teams, statsRows, goalsRows] = await Promise.all([
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
    sql`SELECT team_id, value FROM settings WHERE key = 'team_goals'`,
  ]);

  const statsMap: Record<string, TeamStats> = {};
  for (const row of statsRows) {
    statsMap[row.team_id as string] = row as unknown as TeamStats;
  }

  const goalsMap: Record<string, TeamGoals> = {};
  for (const row of goalsRows) {
    const val = row.value as TeamGoals;
    if (val && (val.targetAvgScore || val.targetGreenPct)) {
      goalsMap[row.team_id as string] = val;
    }
  }

  const totalCalls = Object.values(statsMap).reduce((s, t) => s + t.call_count, 0);
  const totalReps = Object.values(statsMap).reduce((s, t) => s + t.rep_count, 0);
  const overallAvg = totalCalls > 0
    ? Math.round(Object.values(statsMap).reduce((s, t) => s + t.avg_score * t.call_count, 0) / totalCalls)
    : 0;
  const totalGreen = Object.values(statsMap).reduce((s, t) => s + t.green_count, 0);
  const totalYellow = Object.values(statsMap).reduce((s, t) => s + t.yellow_count, 0);
  const totalRed = Object.values(statsMap).reduce((s, t) => s + t.red_count, 0);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="admin">
      {/* Hero */}
      <div className="admin-hero">
        <div className="admin-hero-top">
          <div>
            <div className="admin-brand">Command Center</div>
            <h1 className="admin-heading">Killer Calls</h1>
            <p className="admin-sub">
              {teams.length} team{teams.length !== 1 ? "s" : ""} tracked across all orgs
            </p>
          </div>
          <div className="admin-date">{dateStr}</div>
        </div>

        <div className="admin-stats">
          <div className="admin-stat-cell">
            <div className="admin-stat-num admin-stat-num--blue">{teams.length}</div>
            <div className="admin-stat-label">Teams</div>
          </div>
          <div className="admin-stat-cell">
            <div className="admin-stat-num admin-stat-num--white">{totalCalls}</div>
            <div className="admin-stat-label">Calls Scored</div>
          </div>
          <div className="admin-stat-cell">
            <div className="admin-stat-num admin-stat-num--white">{totalReps}</div>
            <div className="admin-stat-label">Active Reps</div>
          </div>
          <div className="admin-stat-cell">
            <div className={`admin-stat-num admin-stat-num--${overallAvg >= 80 ? "green" : overallAvg >= 60 ? "yellow" : "red"}`}>
              {overallAvg}
            </div>
            <div className="admin-stat-label">Avg Score</div>
          </div>
        </div>
      </div>

      {/* Teams */}
      <div className="admin-section-hd">
        <span className="admin-section-tag">Teams</span>
        <span className="admin-section-title">All Organizations</span>
        <Link href="/onboard" className="admin-new-team-btn">+ New Team</Link>
      </div>

      {teams.length === 0 ? (
        <div className="admin-empty">
          <div className="admin-empty-icon">&#x1F50D;</div>
          <div className="admin-empty-title">No teams yet</div>
          <div className="admin-empty-text">
            <Link href="/onboard" style={{ color: "var(--blue-bright)" }}>Create your first team</Link> to start tracking calls.
          </div>
        </div>
      ) : (
        <div className="admin-teams">
          {teams.map((team, i) => {
            const stats = statsMap[team.id];
            const goals = goalsMap[team.id];
            const calls = stats?.call_count ?? 0;
            const avg = stats?.avg_score ?? 0;
            const reps = stats?.rep_count ?? 0;
            const green = stats?.green_count ?? 0;
            const yellow = stats?.yellow_count ?? 0;
            const red = stats?.red_count ?? 0;
            const total = green + yellow + red || 1;
            const rc = avg >= 80 ? "g" : avg >= 60 ? "y" : "r";
            const greenPct = Math.round((green / total) * 100);

            const circumference = 2 * Math.PI * 34;
            const offset = circumference - (avg / 100) * circumference;

            return (
              <Link
                href={`/t/${team.slug}`}
                key={team.id}
                className={`team-card team-card--${rc}`}
                style={{ animationDelay: `${0.1 * i + 0.2}s` }}
              >
                {/* Identity */}
                <div className="team-identity">
                  <div className={`team-avatar team-avatar--${rc}`}>
                    {team.name.split(" ").map(w => w[0]).join("").slice(0, 2)}
                  </div>
                  <div className="team-name">{team.name}</div>
                  <div className="team-slug">/t/{team.slug}</div>
                </div>

                {/* Stats center */}
                <div className="team-stats-area">
                  <div className="team-metrics">
                    <div className="team-metric">
                      <div className="team-metric-val">{calls}</div>
                      <div className="team-metric-label">Calls</div>
                    </div>
                    <div className="team-metric">
                      <div className="team-metric-val">{reps}</div>
                      <div className="team-metric-label">Reps</div>
                    </div>
                    <div className="team-metric">
                      <div className="team-metric-val">{green}</div>
                      <div className="team-metric-label">Green</div>
                    </div>
                    <div className="team-metric">
                      <div className="team-metric-val" style={{ color: "var(--yellow)" }}>{yellow}</div>
                      <div className="team-metric-label">Yellow</div>
                    </div>
                    <div className="team-metric">
                      <div className="team-metric-val" style={{ color: "var(--red)" }}>{red}</div>
                      <div className="team-metric-label">Red</div>
                    </div>
                  </div>

                  {/* RAG bar */}
                  <div>
                    <div className="team-rag-bar">
                      <div className="team-rag-seg--g" style={{ width: `${(green / total) * 100}%` }} />
                      <div className="team-rag-seg--y" style={{ width: `${(yellow / total) * 100}%` }} />
                      <div className="team-rag-seg--r" style={{ width: `${(red / total) * 100}%` }} />
                    </div>
                    <div className="team-rag-legend">
                      <span className="team-rag-item">
                        <span className="team-rag-dot team-rag-dot--g" />
                        {greenPct}%
                      </span>
                      <span className="team-rag-item">
                        <span className="team-rag-dot team-rag-dot--y" />
                        {Math.round((yellow / total) * 100)}%
                      </span>
                      <span className="team-rag-item">
                        <span className="team-rag-dot team-rag-dot--r" />
                        {Math.round((red / total) * 100)}%
                      </span>
                    </div>
                    {goals && (
                      <div className="team-goals-row">
                        {goals.targetAvgScore > 0 && (
                          <span className={`team-goal-badge team-goal-badge--${avg >= goals.targetAvgScore ? "g" : "r"}`}>
                            Avg {avg}/{goals.targetAvgScore}
                          </span>
                        )}
                        {goals.targetGreenPct > 0 && (
                          <span className={`team-goal-badge team-goal-badge--${greenPct >= goals.targetGreenPct ? "g" : "r"}`}>
                            Green {greenPct}%/{goals.targetGreenPct}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Score ring */}
                <div className="team-score-area">
                  <div className="team-score-ring">
                    <svg viewBox="0 0 76 76">
                      <circle className="team-score-ring-bg" cx="38" cy="38" r="34" />
                      <circle
                        className={`team-score-ring-fill team-score-ring-fill--${rc}`}
                        cx="38" cy="38" r="34"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                      />
                    </svg>
                    <div className={`team-score-val team-score-val--${rc}`}>{avg}</div>
                  </div>
                  <div className="team-score-label">Avg Score</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
