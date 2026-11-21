/**
 * Stories (redesign R7e; owner feedback round 2 #8: "very raw, not engaging"). The newest story
 * for you plays quietly as a wide stage at the top (its photos cross-fade with a slow pan; still
 * when motion is reduced). The other suggestions are tall cards tagged with their kind; saved ones
 * sit on a quieter row; collage ideas form a mosaic. With no stories yet, one panel makes the
 * first ones. Music for stories lives in Settings → Music (one icon away).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Loader2, Music, Play, Sparkles, X } from "lucide-react";
import type { PhotoItem, StoryModel, SuggestedCollage } from "../types";
import type { NavTab } from "../store/useAppStore";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { collageRows, plural, storyKind, storyMeta } from "./stories/storiesFormat";

/** Collage ideas shown at first; a big library can have over a hundred. */
const COLLAGES_FIRST = 6;
const COLLAGES_MORE = 12;

interface StoriesViewProps {
  onPlayStory: (storyId: number) => void;
  onNavigate: (tab: NavTab) => void;
  onPhotoClick?: (idx: number, photos: PhotoItem[]) => void;
}

const StoryCard: React.FC<{
  story: StoryModel;
  onPlay: () => void;
  actions: React.ReactNode;
}> = ({ story, onPlay, actions }) => {
  const [failed, setFailed] = useState(false);
  const meta = storyMeta(story);
  return (
    <div className="sto-card">
      <button type="button" className="sto-card-play" onClick={onPlay} aria-label={`Play ${story.title}${meta ? `, ${meta}` : ""}`}>
        {story.cover_photo_id && !failed ? (
          <img src={getThumbnailUrl(story.cover_photo_id)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <span className="sto-card-blank" aria-hidden="true" />
        )}
        <span className="sto-card-kind" aria-hidden="true">
          {storyKind(story.story_type)}
        </span>
        <span className="sto-card-caption" aria-hidden="true">
          <span className="sto-card-title">{story.title}</span>
          {meta && <span className="sto-card-meta">{meta}</span>}
        </span>
      </button>
      <span className="sto-card-actions">{actions}</span>
    </div>
  );
};

/** Seconds each photo shows on the stage. */
const STAGE_SECONDS = 5;

function prefersStill(): boolean {
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The newest story for you, playing quietly as a wide stage: its photos cross-fade with a slow
 * pan (one still photo when motion is reduced). Play opens the story.
 */
const StoryStage: React.FC<{ story: StoryModel; onPlay: () => void; onSave: () => void; onHide: () => void }> = ({ story, onPlay, onSave, onHide }) => {
  const photos = (story.preview_photo_ids?.length ? story.preview_photo_ids : story.cover_photo_id ? [story.cover_photo_id] : []).slice(0, 4);
  const [shown, setShown] = useState(0);
  const still = prefersStill();
  useEffect(() => {
    setShown(0);
    if (still || photos.length < 2) return;
    const timer = window.setInterval(() => setShown((i) => (i + 1) % photos.length), STAGE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [story.id, photos.length, still]);
  const meta = storyMeta(story);
  return (
    <section className={`sto-stage${still ? " is-still" : ""}`} aria-label={`Newest story: ${story.title}`}>
      <div className="sto-stage-photos" aria-hidden="true">
        {photos.length ? (
          photos.map((id, i) => (
            <img key={id} src={getThumbnailUrl(id)} alt="" draggable={false} className={i === shown ? "is-on" : undefined} style={{ animationDuration: `${STAGE_SECONDS + 1.5}s` }} />
          ))
        ) : (
          <span className="sto-card-blank" />
        )}
      </div>
      <div className="sto-stage-text">
        <span className="sto-stage-kind">{storyKind(story.story_type)}</span>
        <h2 className="sto-stage-title">{story.title}</h2>
        {meta && <p className="sto-stage-meta">{meta}</p>}
        <div className="sto-stage-actions">
          <button type="button" className="sto-stage-play" onClick={onPlay}>
            <Play size={16} fill="currentColor" /> Play story
          </button>
          <button type="button" className="sto-stage-btn" aria-label={`Save ${story.title}`} onClick={onSave}>
            <Bookmark size={15} /> Save
          </button>
          <button type="button" className="sto-stage-btn is-quiet" aria-label={`Hide ${story.title}`} title="Hide" onClick={onHide}>
            <X size={15} />
          </button>
        </div>
      </div>
      {photos.length > 1 && !still && (
        <div className="sto-stage-dots" aria-hidden="true">
          {photos.map((id, i) => (
            <span key={id} className={i === shown ? "is-on" : undefined} />
          ))}
        </div>
      )}
    </section>
  );
};

export const StoriesView: React.FC<StoriesViewProps> = ({ onPlayStory, onNavigate, onPhotoClick }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [forYou, setForYou] = useState<StoryModel[] | null>(null);
  const [saved, setSaved] = useState<StoryModel[]>([]);
  const [collages, setCollages] = useState<SuggestedCollage[] | null>(null);
  const [making, setMaking] = useState(false);
  const [savingCollage, setSavingCollage] = useState<string | null>(null);
  const [collagesShown, setCollagesShown] = useState(COLLAGES_FIRST);

  const loadStories = useCallback(async () => {
    const get = async (path: string): Promise<StoryModel[] | null> => {
      try {
        const res = await apiFetch(path);
        const data = res.ok ? await res.json() : null;
        return Array.isArray(data) ? data : null;
      } catch {
        return null;
      }
    };
    const [fresh, kept] = await Promise.all([get("/api/stories?ephemeral_only=true"), get("/api/stories?saved_only=true")]);
    setForYou(fresh ?? []);
    if (kept) setSaved(kept);
  }, []);

  const loadCollages = useCallback(async () => {
    try {
      const res = await apiFetch("/api/creatives/suggestions");
      const data = res.ok ? await res.json() : null;
      setCollages(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {
      setCollages([]);
    }
  }, []);

  useEffect(() => {
    loadStories();
    loadCollages();
  }, [loadStories, loadCollages]);

  useEffect(() => {
    // Reload when another screen (Albums, the story player) changes stories; our own changes are already shown.
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail?.source !== "stories-view") loadStories();
    };
    window.addEventListener("stories-changed", onChange);
    return () => window.removeEventListener("stories-changed", onChange);
  }, [loadStories]);

  const makeStories = async () => {
    setMaking(true);
    const before = new Set((forYou ?? []).map((s) => s.id));
    try {
      const res = await apiFetch("/api/stories/generate", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The engine answers with every story; reload For you and Saved separately so saved
      // stories don't show up again under For you.
      const fresh = await apiFetch("/api/stories?ephemeral_only=true").then((r) => (r.ok ? r.json() : []));
      const list: StoryModel[] = Array.isArray(fresh) ? fresh : [];
      setForYou(list);
      const added = list.filter((s) => !before.has(s.id)).length;
      showToast(added ? `Made ${plural(added, "new story", "new stories")}.` : "No new stories this time. Your stories are up to date.", added ? "success" : "info");
    } catch {
      showToast("New stories couldn't be made right now. Try again later.", "warning");
    } finally {
      setMaking(false);
    }
  };

  const setSavedState = async (story: StoryModel, keep: boolean) => {
    try {
      const res = await apiFetch(`/api/stories/${story.id}/save`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_saved: keep }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (keep) {
        setForYou((prev) => (prev ?? []).filter((s) => s.id !== story.id));
        setSaved((prev) => [{ ...story, is_saved: true }, ...prev.filter((s) => s.id !== story.id)]);
        showToast(`Saved ${story.title}. It also stays in Albums → Saved stories.`, "success");
      } else {
        setSaved((prev) => prev.filter((s) => s.id !== story.id));
        setForYou((prev) => [{ ...story, is_saved: false }, ...(prev ?? []).filter((s) => s.id !== story.id)]);
        showToast(`${story.title} moved back to For you.`, "info");
      }
      window.dispatchEvent(new CustomEvent("stories-changed", { detail: { storyId: story.id, action: "saved", isSaved: keep, source: "stories-view" } }));
    } catch {
      showToast("That story couldn't be changed. Try again.", "warning");
    }
  };

  const hideStory = async (story: StoryModel) => {
    try {
      const res = await apiFetch(`/api/stories/${story.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForYou((prev) => (prev ?? []).filter((s) => s.id !== story.id));
    } catch {
      showToast("That story couldn't be removed. Try again.", "warning");
    }
  };

  const saveCollage = async (idea: SuggestedCollage) => {
    if (savingCollage || idea.is_already_saved) return;
    setSavingCollage(idea.id);
    try {
      const res = await apiFetch("/api/creatives/suggestions/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestion_id: idea.id, photo_ids: idea.photo_ids, layout: idea.layout || "mosaic", title: idea.title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = typeof data.detail === "string" && data.detail.includes("on disk");
        showToast(
          missing
            ? `${idea.title} couldn't be made: some of its photos aren't on this computer (a moved folder or an unplugged drive).`
            : "That collage couldn't be saved. Try again.",
          "warning",
        );
        return;
      }
      setCollages((prev) => (prev ?? []).map((c) => (c.id === idea.id ? { ...c, is_already_saved: true, saved_photo_id: data.photo_id ?? null } : c)));
      showToast(`Saved ${idea.title}. You'll find it in Albums → Collages.`, "success");
      window.dispatchEvent(new CustomEvent("library-changed"));
    } catch {
      showToast("That collage couldn't be saved. Try again.", "warning");
    } finally {
      setSavingCollage(null);
    }
  };

  const openCollage = async (idea: SuggestedCollage) => {
    if (!idea.saved_photo_id || !onPhotoClick) {
      onNavigate("albums");
      return;
    }
    try {
      const res = await apiFetch(`/api/photos/${idea.saved_photo_id}`);
      if (res.ok) {
        onPhotoClick(0, [await res.json()]);
        return;
      }
    } catch {
      /* fall through */
    }
    onNavigate("albums");
  };

  const total = (forYou?.length ?? 0) + saved.length;

  return (
    <div className="alb-page sto-page">
      <div className="dash-header">
        <h1 className="dash-title">Stories</h1>
        <span className="dash-subtitle">{forYou ? plural(total, "story", "stories") : ""}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="dash-icon-btn" aria-label="Story music" title="Story music (in Settings)" onClick={() => useAppStore.getState().openSettings("music")}>
          <Music size={16} />
        </button>
        <button type="button" className="dash-btn" onClick={makeStories} disabled={making}>
          {making && <Loader2 size={13} className="spin" />}
          {making ? "Making stories…" : "Make new stories"}
        </button>
      </div>

      {forYou === null ? (
        <div className="sto-stage is-loading" aria-hidden="true" />
      ) : forYou.length === 0 && saved.length === 0 ? (
        // No stories yet: one inviting panel that makes the first ones.
        <section className="sto-welcome" aria-labelledby="sto-welcome-title">
          <Sparkles size={26} aria-hidden="true" />
          <h2 id="sto-welcome-title">Your photos, told as stories</h2>
          <p>Trips, birthdays, this week years ago, and old prints brought back. Stories are made on this computer from your own photos.</p>
          <button type="button" className="sto-stage-play" onClick={makeStories} disabled={making}>
            {making ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {making ? "Making stories…" : "Make my first stories"}
          </button>
        </section>
      ) : forYou.length === 0 ? (
        <div className="dash-note">
          No new stories right now. <strong>Make new stories</strong> looks through your photos for trips, birthdays and years gone by.
        </div>
      ) : (
        <>
          <StoryStage
            story={forYou[0]}
            onPlay={() => onPlayStory(forYou[0].id)}
            onSave={() => setSavedState(forYou[0], true)}
            onHide={() => hideStory(forYou[0])}
          />
          {forYou.length > 1 && (
            <section className="alb-section" aria-labelledby="sto-for-you">
              <h2 id="sto-for-you" className="dash-section-title">
                More for you
              </h2>
              <div className="sto-row">
                {forYou.slice(1).map((story) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    onPlay={() => onPlayStory(story.id)}
                    actions={
                      <>
                        <button type="button" className="sto-action" aria-label={`Save ${story.title}`} title="Save" onClick={() => setSavedState(story, true)}>
                          <Bookmark size={14} />
                        </button>
                        <button type="button" className="sto-action" aria-label={`Hide ${story.title}`} title="Hide" onClick={() => hideStory(story)}>
                          <X size={14} />
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {(forYou === null || forYou.length > 0 || saved.length > 0) && (
      <section className="alb-section sto-saved" aria-labelledby="sto-saved">
        <h2 id="sto-saved" className="dash-section-title">
          Saved
        </h2>
        {saved.length === 0 ? (
          <p className="dash-muted">Stories you save stay here, and in Albums → Saved stories.</p>
        ) : (
          <div className="sto-row">
            {saved.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                onPlay={() => onPlayStory(story.id)}
                actions={
                  <button
                    type="button"
                    className="sto-action is-on"
                    aria-label={`Unsave ${story.title}`}
                    title="Saved. Click to move back to For you"
                    onClick={() => setSavedState(story, false)}
                  >
                    <BookmarkCheck size={14} />
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>
      )}

      {(collages === null || collages.length > 0) && (
        <section className="alb-section" aria-labelledby="sto-collages">
          <h2 id="sto-collages" className="dash-section-title">
            Collage ideas
          </h2>
          {collages === null ? null : (
            <div className="sto-collages">
              {collages.slice(0, collagesShown).map((idea) => {
                // The preview has the collage's own layout: one cell per photo, rows as the engine makes them.
                const ids = idea.photo_ids.slice(0, 9);
                let next = 0;
                return (
                  <div key={idea.id} className="sto-collage">
                    <div className="sto-collage-grid" aria-hidden="true">
                      {collageRows(ids.length).map((cols, r) => (
                        <div key={r} className="sto-collage-row" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                          {ids.slice(next, (next += cols)).map((id) => (
                            <img key={id} src={getThumbnailUrl(id)} alt="" loading="lazy" draggable={false} />
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="sto-collage-foot">
                      <span className="sto-collage-text">
                        <span className="alb-cover-name">{idea.title}</span>
                        {idea.subtitle && <span className="dash-muted">{idea.subtitle}</span>}
                      </span>
                      {idea.is_already_saved ? (
                        <button type="button" className="dash-btn dash-btn-small" onClick={() => openCollage(idea)}>
                          Open
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="dash-btn dash-btn-small"
                          aria-label={`Save ${idea.title}`}
                          disabled={!!savingCollage}
                          onClick={() => saveCollage(idea)}
                        >
                          {savingCollage === idea.id && <Loader2 size={12} className="spin" />}
                          {savingCollage === idea.id ? "Saving…" : "Save"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {collages && collages.length > collagesShown && (
            <div>
              <button type="button" className="dash-btn" onClick={() => setCollagesShown((n) => n + COLLAGES_MORE)}>
                Show more ideas ({(collages.length - collagesShown).toLocaleString()} more)
              </button>
            </div>
          )}
        </section>
      )}

    </div>
  );
};
