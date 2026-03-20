"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface AeEntry {
  name: string;
  email: string;
  slackId: string;
}

interface CreatedTeam {
  id: string;
  slug: string;
  name: string;
  admin_token: string;
}

const STEPS = ["Team", "Roster", "Integrations", "Review"] as const;

export default function OnboardClient() {
  const [step, setStep] = useState(0);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [slugError, setSlugError] = useState("");

  // Auth
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

  // Step 1: Team
  const [teamName, setTeamName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);

  function handleNameChange(val: string) {
    setTeamName(val);
    if (!slugManual) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }

  // Step 2: Roster
  const [roster, setRoster] = useState<AeEntry[]>([]);
  const [newAe, setNewAe] = useState<AeEntry>({ name: "", email: "", slackId: "" });

  function addAe() {
    if (!newAe.name.trim() || !newAe.email.trim()) return;
    setRoster([...roster, { ...newAe }]);
    setNewAe({ name: "", email: "", slackId: "" });
  }

  function removeAe(idx: number) {
    setRoster(roster.filter((_, i) => i !== idx));
  }

  // Step 3: Integrations
  const [appUrl, setAppUrl] = useState("");
  const [slackReviews, setSlackReviews] = useState("");
  const [slackKiller, setSlackKiller] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [firefliesApiKey, setFirefliesApiKey] = useState("");

  // Success state
  const [createdTeam, setCreatedTeam] = useState<CreatedTeam | null>(null);
  const [copied, setCopied] = useState(false);

  function showToast(msg: string, error?: boolean) {
    setToast({ msg, error });
    setTimeout(() => setToast(null), error ? 4000 : 2500);
  }

  function canNext(): boolean {
    if (step === 0) return !!teamName.trim() && !!slug.trim() && /^[a-z0-9-]+$/.test(slug);
    return true;
  }

  async function handleCreate() {
    setCreating(true);
    setSlugError("");
    try {
      const settings: Record<string, unknown> = {};
      if (roster.length > 0) settings.ae_roster = roster;
      if (appUrl) settings.app_url = appUrl;
      if (slackReviews) settings.slack_channel_reviews = slackReviews;
      if (slackKiller) settings.slack_channel_killer = slackKiller;
      if (slackBotToken) settings.slack_bot_token = slackBotToken;
      if (firefliesApiKey) settings.fireflies_api_key = firefliesApiKey;

      const res = await fetch("/api/teams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: teamName.trim(),
          slug: slug.trim(),
          settings,
        }),
      });

      if (res.status === 409) {
        setSlugError("A team with this slug already exists");
        setStep(0);
        setCreating(false);
        return;
      }

      if (res.status === 401) {
        setAuthed(false);
        localStorage.removeItem("kc_settings_token");
        showToast("Invalid token — please re-enter", true);
        setCreating(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(`Error: ${(data as { error?: string }).error || `HTTP ${res.status}`}`, true);
        setCreating(false);
        return;
      }

      const data = await res.json();
      setCreatedTeam(data.team);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Network error"}`, true);
    } finally {
      setCreating(false);
    }
  }

  function copyToken() {
    if (!createdTeam) return;
    navigator.clipboard.writeText(createdTeam.admin_token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Auth gate
  if (!authed) {
    return (
      <div className="onboard-wrap">
        <nav className="rpt-nav">
          <Link href="/" className="nav-brand">Killer Calls</Link>
          <span className="nav-sep">/</span>
          <span className="nav-crumb">Onboard</span>
          <Link href="/" className="nav-back">&larr; Home</Link>
        </nav>

        <div className="settings-auth-gate">
          <div className="settings-icon">&#128274;</div>
          <h2 className="settings-title">Super Admin Access</h2>
          <p className="settings-subtitle">Enter CRON_SECRET to create a new team</p>
          <div className="settings-auth-form">
            <input
              type="password"
              className="settings-input"
              placeholder="CRON_SECRET"
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
              Unlock
            </button>
          </div>
        </div>
        {toast && <div className={`settings-toast ${toast.error ? "settings-toast--error" : ""}`}>{toast.msg}</div>}
      </div>
    );
  }

  // Success state
  if (createdTeam) {
    return (
      <div className="onboard-wrap">
        <nav className="rpt-nav">
          <Link href="/" className="nav-brand">Killer Calls</Link>
          <span className="nav-sep">/</span>
          <span className="nav-crumb">Onboard</span>
          <Link href="/" className="nav-back">&larr; Home</Link>
        </nav>

        <div className="onboard-success">
          <div className="onboard-success-icon">&#9989;</div>
          <div className="onboard-success-title">Team Created</div>
          <div className="onboard-success-sub">
            <strong>{createdTeam.name}</strong> is live at /t/{createdTeam.slug}
          </div>

          <div className="onboard-token-card">
            <div className="onboard-token-label">Admin Token</div>
            <div className="onboard-token-box">
              <span className="onboard-token-value">{createdTeam.admin_token}</span>
              <button className="onboard-token-copy" onClick={copyToken}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="onboard-token-warning">
              Save this — it cannot be retrieved later
            </div>
          </div>

          <div className="onboard-success-links">
            <Link href={`/t/${createdTeam.slug}`} className="onboard-success-link">
              View Library &rarr;
            </Link>
            <Link href={`/t/${createdTeam.slug}/settings`} className="onboard-success-link">
              Team Settings &rarr;
            </Link>
            <Link href="/" className="onboard-success-link">
              Command Center &rarr;
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-wrap">
      {/* NAV */}
      <nav className="rpt-nav">
        <Link href="/" className="nav-brand">Killer Calls</Link>
        <span className="nav-sep">/</span>
        <span className="nav-crumb">Onboard</span>
        <Link href="/" className="nav-back">&larr; Home</Link>
      </nav>

      {/* STEPPER */}
      <div className="onboard-stepper">
        {STEPS.map((label, i) => (
          <div className="onboard-step" key={label}>
            <div className="onboard-step-btn">
              <div
                className={`onboard-step-circle ${
                  i === step ? "onboard-step-circle--active" :
                  i < step ? "onboard-step-circle--done" : ""
                }`}
              >
                {i < step ? "\u2713" : i + 1}
              </div>
              <div
                className={`onboard-step-label ${
                  i === step ? "onboard-step-label--active" :
                  i < step ? "onboard-step-label--done" : ""
                }`}
              >
                {label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`onboard-step-line ${i < step ? "onboard-step-line--done" : ""}`} />
            )}
          </div>
        ))}
      </div>

      {/* STEP CONTENT */}
      <div className="onboard-content" key={step}>
        {/* Step 1: Team */}
        {step === 0 && (
          <>
            <div className="onboard-step-title">Team Basics</div>
            <div className="onboard-step-desc">Name your organization and choose a URL slug.</div>

            <div className="onboard-field">
              <label className="onboard-field-label">Team Name</label>
              <input
                className="settings-input"
                placeholder="e.g. Acme Sales"
                value={teamName}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
              />
            </div>

            <div className="onboard-field">
              <label className="onboard-field-label">URL Slug</label>
              <input
                className="settings-input"
                placeholder="e.g. acme-sales"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugManual(true);
                  setSlugError("");
                }}
              />
              {slug && <div className="onboard-slug-preview">/t/{slug}</div>}
              {slug && !/^[a-z0-9-]+$/.test(slug) && (
                <div className="onboard-field-error">Lowercase letters, numbers, and hyphens only</div>
              )}
              {slugError && <div className="onboard-field-error">{slugError}</div>}
            </div>
          </>
        )}

        {/* Step 2: Roster */}
        {step === 1 && (
          <>
            <div className="onboard-step-title">AE Roster</div>
            <div className="onboard-step-desc">Add account executives. You can also do this later in settings.</div>

            <div className="settings-card">
              <div className="settings-card-header">Team Members</div>
              {roster.length > 0 && (
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Slack ID</th>
                      <th className="center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((ae, i) => (
                      <tr key={i}>
                        <td>{ae.name}</td>
                        <td><span className="settings-mono">{ae.email}</span></td>
                        <td><span className="settings-mono">{ae.slackId || "—"}</span></td>
                        <td className="center">
                          <button className="settings-btn settings-btn--remove" onClick={() => removeAe(i)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                <button
                  className="settings-btn settings-btn--add"
                  onClick={addAe}
                  disabled={!newAe.name.trim() || !newAe.email.trim()}
                >
                  + Add
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3: Integrations */}
        {step === 2 && (
          <>
            <div className="onboard-step-title">Integrations</div>
            <div className="onboard-step-desc">Connect Slack and Fireflies. All fields are optional — configure later in settings.</div>

            <div className="settings-card">
              <div className="settings-card-header">App URL</div>
              <div style={{ padding: 20 }}>
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
            </div>

            <div className="settings-card" style={{ marginTop: 16 }}>
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

            <div className="settings-card" style={{ marginTop: 16 }}>
              <div className="settings-card-header">API Keys</div>
              <div className="settings-form-grid">
                <label className="settings-label">
                  <span>Slack Bot token</span>
                  <input
                    className="settings-input"
                    value={slackBotToken}
                    onChange={(e) => setSlackBotToken(e.target.value)}
                    placeholder="xoxb-..."
                  />
                </label>
                <label className="settings-label">
                  <span>Fireflies API key</span>
                  <input
                    className="settings-input"
                    value={firefliesApiKey}
                    onChange={(e) => setFirefliesApiKey(e.target.value)}
                    placeholder="Optional — uses global key"
                  />
                </label>
              </div>
            </div>
          </>
        )}

        {/* Step 4: Review */}
        {step === 3 && (
          <>
            <div className="onboard-step-title">Review & Create</div>
            <div className="onboard-step-desc">Confirm everything looks good, then create your team.</div>

            <div className="onboard-review-card">
              <div className="onboard-review-header">Team</div>
              <div className="onboard-review-body">
                <div className="onboard-review-row">
                  <span className="onboard-review-key">Name</span>
                  <span className="onboard-review-val">{teamName}</span>
                </div>
                <div className="onboard-review-row">
                  <span className="onboard-review-key">Slug</span>
                  <span className="onboard-review-val">/t/{slug}</span>
                </div>
              </div>
            </div>

            <div className="onboard-review-card">
              <div className="onboard-review-header">Roster ({roster.length} members)</div>
              <div className="onboard-review-body">
                {roster.length === 0 ? (
                  <span className="onboard-review-empty">No roster entries — can add later in settings</span>
                ) : (
                  roster.map((ae, i) => (
                    <div className="onboard-review-row" key={i}>
                      <span className="onboard-review-val">{ae.name}</span>
                      <span className="onboard-review-key">{ae.email}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="onboard-review-card">
              <div className="onboard-review-header">Integrations</div>
              <div className="onboard-review-body">
                {[
                  ["App URL", appUrl],
                  ["Reviews Channel", slackReviews],
                  ["Killer Channel", slackKiller],
                  ["Slack Bot", slackBotToken ? "Configured" : ""],
                  ["Fireflies Key", firefliesApiKey ? "Configured" : ""],
                ].map(([label, val]) => (
                  <div className="onboard-review-row" key={label}>
                    <span className="onboard-review-key">{label}</span>
                    <span className={val ? "onboard-review-val" : "onboard-review-empty"}>
                      {val || "Not set"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* NAV BAR */}
      <div className="onboard-nav">
        {step > 0 ? (
          <button className="onboard-nav-back" onClick={() => setStep(step - 1)}>
            &larr; Back
          </button>
        ) : <div />}

        {step < 3 ? (
          <button
            className="onboard-nav-next"
            onClick={() => setStep(step + 1)}
            disabled={!canNext()}
          >
            Next &rarr;
          </button>
        ) : (
          <button
            className="onboard-nav-next"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create Team"}
          </button>
        )}
      </div>

      {/* TOAST */}
      {toast && <div className={`settings-toast ${toast.error ? "settings-toast--error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
