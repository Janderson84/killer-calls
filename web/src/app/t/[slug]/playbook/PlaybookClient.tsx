"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface PlaybookExample {
  id: string;
  category: string;
  title: string;
  body: string;
  rep_name: string | null;
  company_name: string | null;
  call_date: string | null;
  timestamp: string | null;
  scorecard_id: string | null;
  pinned: boolean;
  source: string;
  metadata: any;
  created_at: string;
}

interface PlaybookStats {
  category: string;
  count: number;
}

interface Props {
  examples: PlaybookExample[];
  stats: PlaybookStats[];
  team: { id: string; slug: string; name: string };
  query: string;
  category: string;
  total: number;
}

const CATEGORIES = [
  { key: "", label: "All" },
  { key: "objection_handling", label: "Objection Handling" },
  { key: "close_execution", label: "Close Execution" },
  { key: "discovery_win", label: "Discovery Wins" },
  { key: "quote", label: "Quotes" },
];

const CATEGORY_COLORS: Record<string, string> = {
  objection_handling: "#ef4444",
  close_execution: "#22c55e",
  discovery_win: "#3b82f6",
  quote: "#a855f7",
};

const CATEGORY_LABELS: Record<string, string> = {
  objection_handling: "Objection Handling",
  close_execution: "Close Execution",
  discovery_win: "Discovery Win",
  quote: "Quote",
};

function formatDate(d: string | null): string {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

export default function PlaybookClient({
  examples,
  stats,
  team,
  query,
  category,
  total,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(query);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [pinning, setPinning] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state for adding examples
  const [formCategory, setFormCategory] = useState("objection_handling");
  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formRepName, setFormRepName] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const totalAll = stats.reduce((s, r) => s + r.count, 0);

  function getCount(cat: string): number {
    if (!cat) return totalAll;
    return stats.find((s) => s.category === cat)?.count ?? 0;
  }

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) {
          params.set(k, v);
        } else {
          params.delete(k);
        }
      }
      params.delete("page"); // reset page on filter change
      router.push(`/t/${team.slug}/playbook?${params.toString()}`);
    },
    [router, searchParams, team.slug]
  );

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParams({ q: value });
    }, 300);
  }

  function handleCategoryClick(cat: string) {
    updateParams({ category: cat });
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePin(id: string, currentPinned: boolean) {
    setPinning((prev) => new Set(prev).add(id));
    try {
      await fetch("/api/playbook", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ id, pinned: !currentPinned }),
      });
      router.refresh();
    } finally {
      setPinning((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formBody.trim()) return;
    setFormSubmitting(true);
    try {
      await fetch("/api/playbook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          teamId: team.id,
          category: formCategory,
          title: formTitle.trim(),
          body: formBody.trim(),
          repName: formRepName.trim() || undefined,
        }),
      });
      setShowModal(false);
      setFormTitle("");
      setFormBody("");
      setFormRepName("");
      router.refresh();
    } finally {
      setFormSubmitting(false);
    }
  }

  function getToken(): string {
    // Try to read from localStorage or prompt
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(`kc_token_${team.slug}`);
      if (stored) return stored;
      const token = prompt("Enter admin token:");
      if (token) {
        localStorage.setItem(`kc_token_${team.slug}`, token);
        return token;
      }
    }
    return "";
  }

  return (
    <div className="playbook-container">
      {/* Header */}
      <div className="playbook-header">
        <Link href={`/t/${team.slug}`} className="playbook-back">
          {team.name}
        </Link>
        <div className="playbook-header-row">
          <div>
            <h1 className="playbook-title">Playbook</h1>
            <p className="playbook-subtitle">
              Real examples from your team&apos;s best calls
            </p>
          </div>
          <button
            className="playbook-add-btn"
            onClick={() => setShowModal(true)}
            title="Add example"
          >
            +
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="playbook-search-wrap">
        <svg
          className="playbook-search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          className="playbook-search"
          placeholder="Search examples..."
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {/* Category tabs */}
      <div className="playbook-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`playbook-tab ${category === cat.key ? "active" : ""}`}
            onClick={() => handleCategoryClick(cat.key)}
            style={
              category === cat.key && cat.key
                ? {
                    borderColor: CATEGORY_COLORS[cat.key],
                    color: CATEGORY_COLORS[cat.key],
                  }
                : undefined
            }
          >
            {cat.label}
            <span className="playbook-tab-count">{getCount(cat.key)}</span>
          </button>
        ))}
      </div>

      {/* Results */}
      {examples.length === 0 ? (
        <div className="playbook-empty">
          <div className="playbook-empty-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <p className="playbook-empty-title">No examples yet</p>
          <p className="playbook-empty-text">
            {query
              ? `No results for "${query}". Try a different search term.`
              : "Add your first playbook example by clicking the + button above."}
          </p>
        </div>
      ) : (
        <div className="playbook-grid">
          {examples.map((ex) => {
            const expanded = expandedIds.has(ex.id);
            const color = CATEGORY_COLORS[ex.category] || "#888";
            return (
              <div
                key={ex.id}
                className={`playbook-card ${expanded ? "playbook-card-expanded" : ""}`}
                style={{ borderTopColor: color }}
              >
                <div className="playbook-card-top">
                  <span
                    className="playbook-card-badge"
                    style={{
                      background: `${color}18`,
                      color: color,
                      borderColor: `${color}33`,
                    }}
                  >
                    {CATEGORY_LABELS[ex.category] || ex.category}
                  </span>
                  <button
                    className={`playbook-pin ${ex.pinned ? "pinned" : ""}`}
                    onClick={() => handlePin(ex.id, ex.pinned)}
                    disabled={pinning.has(ex.id)}
                    title={ex.pinned ? "Unpin" : "Pin"}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill={ex.pinned ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 17v5M9 2h6l-1 7h4l-7 8-1-5H6l3-10z" />
                    </svg>
                  </button>
                </div>

                <h3 className="playbook-card-title">{ex.title}</h3>

                <div
                  className={`playbook-card-body ${expanded ? "" : "clamped"}`}
                  onClick={() => toggleExpand(ex.id)}
                >
                  {ex.body}
                </div>

                <div className="playbook-card-footer">
                  <div className="playbook-card-meta">
                    {ex.rep_name && (
                      <span className="playbook-card-rep">{ex.rep_name}</span>
                    )}
                    {ex.company_name && (
                      <span className="playbook-card-company">
                        {ex.company_name}
                      </span>
                    )}
                    {ex.call_date && (
                      <span className="playbook-card-date">
                        {formatDate(ex.call_date)}
                      </span>
                    )}
                    {ex.timestamp && (
                      <span className="playbook-card-timestamp">
                        {ex.timestamp}
                      </span>
                    )}
                  </div>
                  {ex.scorecard_id && (
                    <Link
                      href={`/t/${team.slug}/calls/${ex.scorecard_id}`}
                      className="playbook-card-link"
                    >
                      View Call &rarr;
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="playbook-pagination">
          <span className="playbook-page-info">
            {examples.length} of {total} examples
          </span>
        </div>
      )}

      {/* Add Modal */}
      {showModal && (
        <div className="playbook-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="playbook-modal" onClick={(e) => e.stopPropagation()}>
            <div className="playbook-modal-header">
              <h2>Add Example</h2>
              <button
                className="playbook-modal-close"
                onClick={() => setShowModal(false)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="playbook-form-field">
                <label>Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  <option value="objection_handling">Objection Handling</option>
                  <option value="close_execution">Close Execution</option>
                  <option value="discovery_win">Discovery Win</option>
                  <option value="quote">Quote</option>
                </select>
              </div>
              <div className="playbook-form-field">
                <label>Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder='e.g. "Budget objection turnaround"'
                  required
                />
              </div>
              <div className="playbook-form-field">
                <label>Body</label>
                <textarea
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Paste the transcript excerpt or describe the example..."
                  rows={6}
                  required
                />
              </div>
              <div className="playbook-form-field">
                <label>
                  Rep Name <span className="optional">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formRepName}
                  onChange={(e) => setFormRepName(e.target.value)}
                  placeholder="e.g. Sarah Chen"
                />
              </div>
              <button
                type="submit"
                className="playbook-form-submit"
                disabled={formSubmitting}
              >
                {formSubmitting ? "Adding..." : "Add Example"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
