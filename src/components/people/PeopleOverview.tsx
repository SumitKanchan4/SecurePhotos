/**
 * PeopleOverview: the People screen's main page (redesign R5).
 *
 * Close ones pinned on top with a lime ring, a "Same person?" card that keeps groups
 * accurate (one suggestion at a time), everyone else in a grid, and "Who is this?"
 * cards for unnamed face groups: type a name once and every photo of that group is
 * tagged. A name that matches someone already named adds the group to that person.
 * Split out of PeopleView.tsx (Q5); the person page stays there.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MoreHorizontal, Users, X } from "lucide-react";
import type { FaceScanStatus, MergeSuggestion, PersonItem, UnlabeledClusterItem } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { InlineSearch } from "../ui/InlineSearch";
import { apiFetch, getApiUrl } from "../../services/api";
import { RELATIONSHIPS } from "./PersonPage";

const WHO_IS_THIS_PREVIEW = 6;

/** One side of "Same person?": a big face and up to three more from other photos. */
const SuggestionSide: React.FC<{ title: string; count: number; faces: (number | null)[]; name?: string }> = ({ title, count, faces, name }) => {
  const [first, ...rest] = faces;
  return (
    <figure className="people-compare-side">
      <div className="people-compare-faces">
        <Face faceId={first ?? null} name={name} size={104} />
        {rest.length > 0 && (
          <div className="people-compare-more">
            {rest.slice(0, 3).map((id, i) => (
              <Face key={id ?? `none-${i}`} faceId={id ?? null} name={name} size={50} />
            ))}
          </div>
        )}
      </div>
      <figcaption>
        <strong>{title}</strong>
        <span>{photoCountLabel(count)}</span>
      </figcaption>
    </figure>
  );
};

export function photoCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "photo" : "photos"}`;
}

/** People whose name or relationship contains the search text (case-insensitive). */
export function matchesSearch(person: PersonItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return person.name.toLowerCase().includes(q) || (person.relationship_type ?? "").toLowerCase().includes(q);
}

export const Face: React.FC<{ faceId?: number | null; name?: string; size: number; className?: string }> = ({ faceId, name, size, className }) => {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!faceId || failed) {
    return (
      <span className={`people-face people-face-empty ${className ?? ""}`} style={style} aria-hidden="true">
        {name ? name.charAt(0).toUpperCase() : <Users size={size / 2.6} />}
      </span>
    );
  }
  return (
    <img
      className={`people-face ${className ?? ""}`}
      style={style}
      src={getApiUrl(`/api/people/faces/${faceId}/crop`)}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
};

export interface PeopleOverviewProps {
  people: PersonItem[];
  clusters: UnlabeledClusterItem[];
  scanStatus: FaceScanStatus;
  isLoading: boolean;
  isResetting: boolean;
  onOpenPerson: (person: PersonItem) => void;
  onInspectFace: (faceId: number) => void;
  /** Reloads people and unnamed groups. */
  onRefresh: () => Promise<void>;
  onScan: () => void;
  onReset: () => void;
}

export const PeopleOverview: React.FC<PeopleOverviewProps> = ({
  people,
  clusters,
  scanStatus,
  isLoading,
  isResetting,
  onOpenPerson,
  onInspectFace,
  onRefresh,
  onScan,
  onReset,
}) => {
  const { showToast } = useAppStore();
  // Name filter for this page (R9c: a field in the header, not the global search).
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [answering, setAnswering] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Owner feedback (round 1, #23): a new person gets a relationship while being named.
  const [relations, setRelations] = useState<Record<string, string>>({});
  const [busyCluster, setBusyCluster] = useState<string | null>(null);
  const [showAllUnnamed, setShowAllUnnamed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadSuggestions = useCallback(async () => {
    try {
      const res = await apiFetch("/api/people/merge-suggestions");
      if (res.ok) setSuggestions(await res.json());
    } catch {
      /* Suggestions are optional; the page works without them. */
    }
  }, []);

  // Refresh suggestions whenever the set of people or groups changes.
  const dataKey = `${people.map((p) => `${p.id}:${p.confirmed_count}`).join(",")}|${clusters.map((c) => c.cluster_id).join(",")}`;
  useEffect(() => {
    loadSuggestions();
  }, [dataKey, loadSuggestions]);

  const closeOnes = useMemo(() => people.filter((p) => p.is_close_one && matchesSearch(p, searchQuery)), [people, searchQuery]);
  const everyone = useMemo(() => people.filter((p) => !p.is_close_one && matchesSearch(p, searchQuery)), [people, searchQuery]);
  const suggestion = suggestions[0] ?? null;
  const visibleUnnamed = showAllUnnamed ? clusters : clusters.slice(0, WHO_IS_THIS_PREVIEW);

  const answerSuggestion = async (merge: boolean) => {
    if (!suggestion) return;
    setAnswering(true);
    try {
      const res = merge
        ? await apiFetch(`/api/people/${suggestion.person_id}/merge-cluster`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cluster_id: suggestion.cluster_id }),
          })
        : await apiFetch("/api/people/merge-suggestions/reject", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ person_id: suggestion.person_id, cluster_id: suggestion.cluster_id }),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuggestions((prev) => prev.slice(1));
      if (merge) {
        showToast(`Added ${photoCountLabel(suggestion.cluster_photo_count)} to ${suggestion.person_name}.`, "success");
        await onRefresh();
      }
      await loadSuggestions();
    } catch (err) {
      console.error("Could not answer the suggestion:", err);
      showToast("That didn't work. Please try again.", "warning");
    } finally {
      setAnswering(false);
    }
  };

  const nameGroup = async (cluster: UnlabeledClusterItem) => {
    const name = (drafts[cluster.cluster_id] ?? "").trim();
    if (!name) return;
    setBusyCluster(cluster.cluster_id);
    try {
      const res = await apiFetch("/api/people/tag-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A new person gets the relationship picked here; naming never changes an existing
        // person's relationship (null).
        body: JSON.stringify({
          cluster_id: cluster.cluster_id,
          name,
          relationship_type: people.some((p) => p.name.toLowerCase() === name.toLowerCase()) ? null : relations[cluster.cluster_id] || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[cluster.cluster_id];
        return next;
      });
      showToast(`Tagged ${name} in ${photoCountLabel(data.photos_tagged ?? cluster.photo_count)}.`, "success");
      await onRefresh();
    } catch (err) {
      console.error("Could not name the group:", err);
      showToast("That name couldn't be saved. Please try again.", "warning");
    } finally {
      setBusyCluster(null);
    }
  };

  const notAPerson = async (cluster: UnlabeledClusterItem) => {
    setBusyCluster(cluster.cluster_id);
    try {
      const res = await apiFetch(`/api/people/clusters/${cluster.cluster_id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await onRefresh();
    } catch (err) {
      console.error("Could not hide the group:", err);
      showToast("That didn't work. Please try again.", "warning");
    } finally {
      setBusyCluster(null);
    }
  };

  const nothingYet = !isLoading && people.length === 0 && clusters.length === 0;
  const searching = searchQuery.trim().length > 0;

  return (
    <div className="people-page">
      <div className="people-header">
        <h1 className="people-title">People</h1>
        <span className="people-subtitle">
          {people.length.toLocaleString()} named · {clusters.length.toLocaleString()} to name
        </span>
        {scanStatus.is_scanning && (
          <span className="people-work" role="status">
            <Loader2 size={12} className="spin" />
            Looking for faces · {scanStatus.scanned_photos.toLocaleString()} of {scanStatus.total_photos.toLocaleString()}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {people.length > 0 && <InlineSearch label="Search people" placeholder="Name or relationship" value={searchQuery} onChange={setSearchQuery} />}
        <div className="people-menu-anchor">
          <button
            type="button"
            className="people-icon-btn"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="people-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="people-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={scanStatus.is_scanning}
                  onClick={() => {
                    setMenuOpen(false);
                    onScan();
                  }}
                >
                  <strong>Look for new faces</strong>
                  <small>Checks photos that haven't been scanned yet</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="people-menu-danger"
                  disabled={isResetting}
                  onClick={() => {
                    setMenuOpen(false);
                    onReset();
                  }}
                >
                  <strong>Start over…</strong>
                  <small>Forgets every name and group. Your photos stay safe.</small>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="people-empty">
          <Loader2 size={22} className="spin" />
        </div>
      ) : nothingYet ? (
        <div className="people-empty">
          <Users size={34} />
          <h2>No faces yet</h2>
          <p>{scanStatus.is_scanning ? "Faces will appear here as your photos are checked." : "Look through your photos to find the people in them. Everything stays on this computer."}</p>
          {!scanStatus.is_scanning && (
            <button type="button" className="people-primary-btn" onClick={onScan}>
              Look for faces
            </button>
          )}
        </div>
      ) : (
        <>
          {closeOnes.length > 0 && (
            <section className="people-section" aria-labelledby="people-close-ones">
              <h2 id="people-close-ones" className="people-section-title">Close ones</h2>
              <div className="people-close-row">
                {closeOnes.map((person) => (
                  <button key={person.id} type="button" className="people-person people-person-close" onClick={() => onOpenPerson(person)}>
                    <Face faceId={person.cover_face_id} name={person.name} size={76} className="people-ring" />
                    <span className="people-person-name">{person.name}</span>
                    <span className="people-person-count">{photoCountLabel(person.confirmed_count)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {suggestion && !searching && (
            // Owner feedback (round 1, #24): big faces, several per side, so they can be compared.
            <section className="people-suggestion" aria-label="Same person?">
              <div className="people-suggestion-head">
                <strong>Same person?</strong>
                <span>Do these faces belong to {suggestion.person_name}?</span>
              </div>
              <div className="people-compare">
                <SuggestionSide
                  title={suggestion.person_name}
                  count={suggestion.person_photo_count}
                  faces={suggestion.person_face_ids?.length ? suggestion.person_face_ids : [suggestion.person_face_id]}
                  name={suggestion.person_name}
                />
                <span className="people-compare-vs" aria-hidden="true">?</span>
                <SuggestionSide
                  title="Not named yet"
                  count={suggestion.cluster_photo_count}
                  faces={suggestion.cluster_face_ids?.length ? suggestion.cluster_face_ids : [suggestion.cluster_face_id]}
                />
              </div>
              <div className="people-suggestion-actions">
                <button type="button" className="people-primary-btn" disabled={answering} onClick={() => answerSuggestion(true)}>
                  Yes, same person
                </button>
                <button type="button" className="people-secondary-btn" disabled={answering} onClick={() => answerSuggestion(false)}>
                  Not the same
                </button>
              </div>
            </section>
          )}

          {everyone.length > 0 && (
            <section className="people-section" aria-labelledby="people-everyone">
              <h2 id="people-everyone" className="people-section-title">{closeOnes.length > 0 ? "Everyone" : "People"}</h2>
              <div className="people-grid">
                {everyone.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="people-person"
                    onClick={() => onOpenPerson(person)}
                    title={`${person.name}: ${photoCountLabel(person.confirmed_count)}`}
                  >
                    <Face faceId={person.cover_face_id} name={person.name} size={64} />
                    <span className="people-person-name">{person.name}</span>
                    <span className="people-person-count">{person.confirmed_count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {searching && closeOnes.length === 0 && everyone.length === 0 && (
            <p className="people-no-match">No one named "{searchQuery.trim()}".</p>
          )}

          {clusters.length > 0 && !searching && (
            <section className="people-section" aria-labelledby="people-who">
              <h2 id="people-who" className="people-section-title">Who is this?</h2>
              <datalist id="people-names">
                {people.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              <div className="people-unnamed-grid">
                {visibleUnnamed.map((cluster) => {
                  const draft = drafts[cluster.cluster_id] ?? "";
                  const existing = people.find((p) => p.name.toLowerCase() === draft.trim().toLowerCase());
                  const busy = busyCluster === cluster.cluster_id;
                  return (
                    <form
                      key={cluster.cluster_id}
                      className="people-unnamed"
                      onSubmit={(e) => {
                        e.preventDefault();
                        nameGroup(cluster);
                      }}
                    >
                      <button
                        type="button"
                        className="people-unnamed-face"
                        title="See this face in its photo"
                        aria-label="See this face in its photo"
                        onClick={() => cluster.medoid_face_id && onInspectFace(cluster.medoid_face_id)}
                      >
                        <Face faceId={cluster.medoid_face_id} size={48} />
                      </button>
                      <div className="people-unnamed-fields">
                        <label className="people-unnamed-label">
                          <span>
                            {photoCountLabel(cluster.photo_count)}
                            {existing ? ` · adds to ${existing.name}` : ""}
                          </span>
                          <input
                            list="people-names"
                            placeholder="Add a name"
                            aria-label={`Name for this face (${photoCountLabel(cluster.photo_count)})`}
                            value={draft}
                            disabled={busy}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [cluster.cluster_id]: e.target.value }))}
                          />
                        </label>
                        {/* Under the name, the same width and look as the name box (owner feedback
                            2026-11-18: side by side squeezed the name and didn't line up). */}
                        {draft.trim() && !existing && !busy && (
                          <select
                            className={`people-relation-select${relations[cluster.cluster_id] ? "" : " is-empty"}`}
                            aria-label={`Relationship to ${draft.trim()}`}
                            value={relations[cluster.cluster_id] ?? ""}
                            onChange={(e) => setRelations((prev) => ({ ...prev, [cluster.cluster_id]: e.target.value }))}
                          >
                            <option value="">Relationship (optional)</option>
                            {RELATIONSHIPS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {busy ? (
                        <Loader2 size={16} className="spin" />
                      ) : draft.trim() ? (
                        <button type="submit" className="people-save-btn">
                          Save
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="people-dismiss-btn"
                          aria-label="Not a person"
                          title="Not a person: hide this group"
                          onClick={() => notAPerson(cluster)}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </form>
                  );
                })}
              </div>
              {clusters.length > WHO_IS_THIS_PREVIEW && (
                <button type="button" className="people-secondary-btn people-show-all" onClick={() => setShowAllUnnamed((v) => !v)}>
                  {showAllUnnamed ? "Show fewer" : `Show all ${clusters.length.toLocaleString()}`}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
