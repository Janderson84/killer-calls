"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Tab = "team" | "scoring" | "integrations";

interface AeEntry {
  name: string;
  email: string;
  slackId: string;
  active?: boolean;
}

interface RagThresholds {
  green: number;
  yellow: number;
}

export default function SettingsClient({
  initialSettings,
  teamSlug,
  teamId,
}: {
  initialSettings: Record<string, unknown>;
  teamSlug?: string;
  teamId?: string;
}) {
  const basePath = teamSlug ? `/t/${teamSlug}` : "";
  const [tab, setTab] = useState<Tab>("team");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);

  // Auth state — visible input instead of prompt()
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("kc_settings_token");
    if (saved) {
      setToken(saved);
      setAuthed(true);
    }
  }, []);

  function submitToken() {
    if (!tokenInput.trim()) return;
    localStorage.setItem("kc_settings_token", tokenInput.trim());
    setToken(tokenInput.trim());
    setAuthed(true);
  }

  function clearToken() {
    localStorage.removeItem("kc_settings_token");
    setToken("");
    setAuthed(false);
    setTokenInput("");
    showToast("Token cleared");
  }

  // Team state
  const [roster, setRoster] = useState<AeEntry[]>(
    (initialSettings.ae_roster as AeEntry[]) || []
  );
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<AeEntry>({ name: "", email: "", slackId: "" });
  const [newAe, setNewAe] = useState<AeEntry>({ name: "", email: "", slackId: "", active: true });

  // Scoring state
  const [ragThresholds, setRagThresholds] = useState<RagThresholds>(
    (initialSettings.rag_thresholds as RagThresholds) || { green: 80, yellow: 60 }
  );
  const [minDuration, setMinDuration] = useState<number>(
    (initialSettings.min_call_duration as number) || 20
  );
  const [claudeModel, setClaudeModel] = useState<string>(
    (initialSettings.claude_model as string) || "claude-sonnet-4-6"
  );
  const [killerThreshold, setKillerThreshold] = useState<number>(
    (initialSettings.killer_threshold as number) || 80
  );
  const [excludedPatterns, setExcludedPatterns] = useState<string>(
    ((initialSettings.excluded_patterns as string[]) || []).join("\n")
  );

  // Scoring weights state
  const defaultWeights = { preCall: 6, discovery: 32, presentation: 22, pricing: 28, closing: 12 };
  const [scoringWeights, setScoringWeights] = useState(
    (initialSettings.scoring_weights as typeof defaultWeights) || defaultWeights
  );
  const weightsTotal = scoringWeights.preCall + scoringWeights.discovery + scoringWeights.presentation + scoringWeights.pricing + scoringWeights.closing;

  // Team goals state
  const [teamGoals, setTeamGoals] = useState<{ targetAvgScore: number; targetGreenPct: number }>(
    (initialSettings.team_goals as { targetAvgScore: number; targetGreenPct: number }) || { targetAvgScore: 0, targetGreenPct: 0 }
  );

  // Integrations state
  const [appUrl, setAppUrl] = useState<string>(
    (initialSettings.app_url as string) || ""
  );
  const [slackReviews, setSlackReviews] = useState<string>(
    (initialSettings.slack_channel_reviews as string) || ""
  );
  const [slackKiller, setSlackKiller] = useState<string>(
    (initialSettings.slack_channel_killer as string) || ""
  );
  const [firefliesApiKey, setFirefliesApiKey] = useState<string>(
    (initialSettings.fireflies_api_key as string) || ""
  );
  const [slackBotToken, setSlackBotToken] = useState<string>(
    (initialSettings.slack_bot_token as string) || ""
  );

  function showToast(msg: string, error?: boolean) {
    setToast({ msg, error });
    setTimeout(() => setToast(null), error ? 4000 : 2500);
  }

  // Returns true on success, false on failure
  async function saveSetting(key: string, value: unknown): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ key, value, teamId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = (data as { error?: string }).error || `HTTP ${res.status}`;
        if (res.status === 401) {
          setAuthed(false);
          localStorage.removeItem("kc_settings_token");
          showToast("Invalid token — please re-enter your admin token", true);
        } else {
          showToast(`Error: ${errMsg}`, true);
        }
        return false;
      }
      showToast(`Saved ${key.replace(/_/g, " ")}`);
      return true;
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Save failed"}`, true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Team handlers — only update state after successful save
  async function removeAe(idx: number) {
    const next = roster.filter((_, i) => i !== idx);
    const ok = await saveSetting("ae_roster", next);
    if (ok) setRoster(next);
  }

  async function addAe() {
    if (!newAe.name.trim() || !newAe.email.trim()) return;
    const next = [...roster, { ...newAe }];
    const ok = await saveSetting("ae_roster", next);
    if (ok) {
      setRoster(next);
      setNewAe({ name: "", email: "", slackId: "" });
    }
  }

  async function toggleActive(idx: number) {
    const next = [...roster];
    next[idx] = { ...next[idx], active: next[idx].active === false ? true : false };
    const ok = await saveSetting("ae_roster", next);
    if (ok) setRoster(next);
  }

  function startEdit(idx: number) {
    setEditIdx(idx);
    setEditValues({ ...roster[idx] });
  }

  function cancelEdit() {
    setEditIdx(null);
  }

  async function saveEdit() {
    if (editIdx === null) return;
    const next = [...roster];
    next[editIdx] = { ...editValues };
    const ok = await saveSetting("ae_roster", next);
    if (ok) {
      setRoster(next);
      setEditIdx(null);
    }
  }

  // Scoring save
  async function saveScoring() {
    const patternsArray = excludedPatterns.split("\n").map((p) => p.trim()).filter(Boolean);
    const results = await Promise.all([
      saveSetting("rag_thresholds", ragThresholds),
      saveSetting("min_call_duration", minDuration),
      saveSetting("claude_model", claudeModel),
      saveSetting("killer_threshold", killerThreshold),
      saveSetting("excluded_patterns", patternsArray),
      saveSetting("scoring_weights", scoringWeights),
      saveSetting("team_goals", teamGoals.targetAvgScore ? teamGoals : null),
    ]);
    if (results.every(Boolean)) showToast("All scoring settings saved");
  }

  // Integrations save
  async function saveIntegrations() {
    const promises = [
      saveSetting("app_url", appUrl),
      saveSetting("slack_channel_reviews", slackReviews),
      saveSetting("slack_channel_killer", slackKiller),
    ];
    // Only save secret fields if they were changed (not masked placeholder)
    if (firefliesApiKey && !firefliesApiKey.startsWith("••••")) {
      promises.push(saveSetting("fireflies_api_key", firefliesApiKey));
    }
    if (slackBotToken && !slackBotToken.startsWith("••••")) {
      promises.push(saveSetting("slack_bot_token", slackBotToken));
    }
    const results = await Promise.all(promises);
    if (results.every(Boolean)) showToast("All integration settings saved");
  }

  function maskSecret(val: string): string {
    if (!val) return "";
    if (val.length <= 4) return "••••";
    return "••••" + val.slice(-4);
  }

  // Auth gate
  if (!authed) {
    return (
      <div className="settings-wrap">
        <nav className="rpt-nav">
          <Link href={`${basePath || "/"}`} className="nav-brand">Killer Calls</Link>
          <span className="nav-sep">/</span>
          <span className="nav-crumb">Settings</span>
          <Link href={`${basePath || "/"}`} className="nav-back">&larr; Library</Link>
        </nav>

        <div className="settings-auth-gate">
          <div className="settings-icon">&#128274;</div>
          <h2 className="settings-title">Admin Access</h2>
          <p className="settings-subtitle">Enter your admin token to manage settings</p>
          <div className="settings-auth-form">
            <input
              type="password"
              className="settings-input"
              placeholder="Admin token (CRON_SECRET)"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitToken()}
              autoFocus
            />
            <button
              className="settings-btn settings-btn--primary"
              onClick={submitToken}
              disabled={!tokenInput.trim()}
            >
              Unlock Settings
            </button>
          </div>
        </div>
        {toast && <div className={`settings-toast ${toast.error ? "settings-toast--error" : ""}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div className="settings-wrap">
      {/* NAV */}
      <nav className="rpt-nav">
        <Link href="/" className="nav-brand">Killer Calls</Link>
        <span className="nav-sep">/</span>
        <span className="nav-crumb">Settings</span>
        <Link href="/" className="nav-back">&larr; Library</Link>
      </nav>

      {/* HEADER */}
      <div className="settings-header">
        <div className="settings-header-left">
          <div className="settings-icon">&#9881;</div>
          <div>
            <h1 className="settings-title">Settings</h1>
            <p className="settings-subtitle">Manage team, scoring config, and integrations</p>
          </div>
        </div>
        <button className="settings-clear-token" onClick={clearToken} title="Clear saved auth token">
          Lock &amp; Sign Out
        </button>
      </div>

      {/* TABS */}
      <div className="settings-tabs">
        {(["team", "scoring", "integrations"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`settings-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "team" ? "Team" : t === "scoring" ? "Scoring" : "Integrations"}
          </button>
        ))}
      </div>

      {/* TOAST */}
      {toast && <div className={`settings-toast ${toast.error ? "settings-toast--error" : ""}`}>{toast.msg}</div>}

      {/* TEAM TAB */}
      {tab === "team" && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header">AE Roster</div>
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Slack ID</th>
                  <th className="center">Scoring</th>
                  <th className="center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((ae, i) => (
                  <tr key={i}>
                    {editIdx === i ? (
                      <>
                        <td>
                          <input
                            className="settings-input"
                            value={editValues.name}
                            onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="settings-input"
                            value={editValues.email}
                            onChange={(e) => setEditValues({ ...editValues, email: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="settings-input"
                            value={editValues.slackId}
                            onChange={(e) => setEditValues({ ...editValues, slackId: e.target.value })}
                          />
                        </td>
                        <td className="center">—</td>
                        <td className="center">
                          <div className="settings-actions">
                            <button className="settings-btn settings-btn--save" onClick={saveEdit} disabled={saving}>Save</button>
                            <button className="settings-btn settings-btn--cancel" onClick={cancelEdit}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={ae.active === false ? { opacity: 0.5 } : undefined}>{ae.name}</td>
                        <td style={ae.active === false ? { opacity: 0.5 } : undefined}><span className="settings-mono">{ae.email}</span></td>
                        <td style={ae.active === false ? { opacity: 0.5 } : undefined}><span className="settings-mono">{ae.slackId}</span></td>
                        <td className="center">
                          <button
                            className={`settings-btn ${ae.active === false ? "settings-btn--inactive" : "settings-btn--active"}`}
                            onClick={() => toggleActive(i)}
                            disabled={saving}
                            title={ae.active === false ? "Calls are NOT being scored" : "Calls are being scored"}
                          >
                            {ae.active === false ? "Paused" : "Active"}
                          </button>
                        </td>
                        <td className="center">
                          <div className="settings-actions">
                            <button className="settings-btn settings-btn--edit" onClick={() => startEdit(i)} disabled={saving}>Edit</button>
                            <button className="settings-btn settings-btn--remove" onClick={() => removeAe(i)} disabled={saving}>Remove</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="settings-add-row">
              <input
                className="settings-input"
                placeholder="Name"
                value={newAe.name}
                onChange={(e) => setNewAe({ ...newAe, name: e.target.value })}
              />
              <input
                className="settings-input"
                placeholder="Email"
                value={newAe.email}
                onChange={(e) => setNewAe({ ...newAe, email: e.target.value })}
              />
              <input
                className="settings-input"
                placeholder="Slack ID"
                value={newAe.slackId}
                onChange={(e) => setNewAe({ ...newAe, slackId: e.target.value })}
              />
              <button className="settings-btn settings-btn--add" onClick={addAe} disabled={!newAe.name.trim() || !newAe.email.trim() || saving}>
                + Add AE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SCORING TAB */}
      {tab === "scoring" && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header">RAG Thresholds</div>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>Green minimum</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={ragThresholds.green}
                  onChange={(e) => setRagThresholds({ ...ragThresholds, green: Number(e.target.value) })}
                  min={0}
                  max={100}
                />
              </label>
              <label className="settings-label">
                <span>Yellow minimum</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={ragThresholds.yellow}
                  onChange={(e) => setRagThresholds({ ...ragThresholds, yellow: Number(e.target.value) })}
                  min={0}
                  max={100}
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Call Settings</div>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>Min call duration (minutes)</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={minDuration}
                  onChange={(e) => setMinDuration(Number(e.target.value))}
                  min={1}
                  max={120}
                />
              </label>
              <label className="settings-label">
                <span>Claude model</span>
                <select
                  className="settings-select"
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                >
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
                </select>
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Killer Call Threshold</div>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>Minimum score for #killer-calls</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={killerThreshold}
                  onChange={(e) => setKillerThreshold(Number(e.target.value))}
                  min={0}
                  max={100}
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Excluded Meeting Patterns</div>
            <div style={{ padding: 20 }}>
              <label className="settings-label">
                <span>Skip calls whose title matches any pattern (one regex per line)</span>
                <textarea
                  className="settings-textarea"
                  value={excludedPatterns}
                  onChange={(e) => setExcludedPatterns(e.target.value)}
                  placeholder={"internal\\s+meeting\nstandup\n1:1"}
                  rows={4}
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Scoring Weights</div>
            <p className="settings-hint">Adjust how many of the 100 points each phase is worth.</p>
            <div className="settings-weights-grid">
              {(["preCall", "discovery", "presentation", "pricing", "closing"] as const).map((key) => (
                <div className="settings-weight-item" key={key}>
                  <span>{key === "preCall" ? "Pre-Call" : key.charAt(0).toUpperCase() + key.slice(1)}</span>
                  <input
                    type="number"
                    className="settings-input settings-input--num"
                    value={scoringWeights[key]}
                    onChange={(e) => setScoringWeights({ ...scoringWeights, [key]: Number(e.target.value) })}
                    min={0}
                    max={100}
                  />
                </div>
              ))}
            </div>
            <div className={`settings-weights-total ${weightsTotal === 100 ? "settings-weights-total--ok" : "settings-weights-total--bad"}`}>
              Total: {weightsTotal}/100 {weightsTotal === 100 ? "✓" : "— must equal 100"}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Team Goals</div>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>Target avg score (0-100)</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={teamGoals.targetAvgScore || ""}
                  onChange={(e) => setTeamGoals({ ...teamGoals, targetAvgScore: Number(e.target.value) })}
                  min={0}
                  max={100}
                  placeholder="e.g. 70"
                />
              </label>
              <label className="settings-label">
                <span>Target green % (0-100)</span>
                <input
                  type="number"
                  className="settings-input settings-input--num"
                  value={teamGoals.targetGreenPct || ""}
                  onChange={(e) => setTeamGoals({ ...teamGoals, targetGreenPct: Number(e.target.value) })}
                  min={0}
                  max={100}
                  placeholder="e.g. 40"
                />
              </label>
            </div>
          </div>

          <button
            className="settings-btn settings-btn--primary"
            onClick={saveScoring}
            disabled={saving || weightsTotal !== 100}
          >
            {saving ? "Saving..." : "Save Scoring Settings"}
          </button>
        </div>
      )}

      {/* INTEGRATIONS TAB */}
      {tab === "integrations" && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card-header">App URL</div>
            <label className="settings-label">
              <span>Web app base URL</span>
              <input
                className="settings-input"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
                placeholder="https://web-sage-pi-82.vercel.app"
              />
            </label>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Slack Channels</div>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>#demo-reviews channel ID</span>
                <input
                  className="settings-input"
                  value={slackReviews}
                  onChange={(e) => setSlackReviews(e.target.value)}
                  placeholder="C0XXXXXX"
                />
              </label>
              <label className="settings-label">
                <span>#killer-calls channel ID</span>
                <input
                  className="settings-input"
                  value={slackKiller}
                  onChange={(e) => setSlackKiller(e.target.value)}
                  placeholder="C0XXXXXX"
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">API Keys</div>
            <p className="settings-hint">Override the global keys with team-specific credentials. Leave blank to use the default.</p>
            <div className="settings-form-grid">
              <label className="settings-label">
                <span>Fireflies API key</span>
                <input
                  className="settings-input"
                  value={firefliesApiKey}
                  onChange={(e) => setFirefliesApiKey(e.target.value)}
                  placeholder={initialSettings.fireflies_api_key ? maskSecret(initialSettings.fireflies_api_key as string) : "Uses global key"}
                />
              </label>
              <label className="settings-label">
                <span>Slack Bot token</span>
                <input
                  className="settings-input"
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  placeholder={initialSettings.slack_bot_token ? maskSecret(initialSettings.slack_bot_token as string) : "Uses global token"}
                />
              </label>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">Connected Services</div>
            <div className="settings-services">
              <div className="settings-service">
                <span className="settings-service-dot green"></span>
                <span>Fireflies.ai</span>
                <span className="settings-service-note">Webhook active</span>
              </div>
              <div className="settings-service">
                <span className="settings-service-dot green"></span>
                <span>Slack</span>
                <span className="settings-service-note">Bot connected</span>
              </div>
              <div className="settings-service">
                <span className="settings-service-dot green"></span>
                <span>Neon Postgres</span>
                <span className="settings-service-note">Database active</span>
              </div>
            </div>
          </div>

          <button
            className="settings-btn settings-btn--primary"
            onClick={saveIntegrations}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Integration Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
