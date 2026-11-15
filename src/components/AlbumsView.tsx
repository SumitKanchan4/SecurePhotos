/**
 * Albums (redesign R7d, approved board). Favourites, Saved stories and the automatic Collages
 * album sit on top as albums made for you; your own albums follow as big covers. Opening one
 * shows the album page (photos in the Photos grid, rare actions behind one menu).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Heart, Images, Play, Search, X } from "lucide-react";
import type { AlbumItem, ImportProgressState, PhotoItem, StoryModel } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { AlbumPage, type AlbumPageTarget } from "./albums/AlbumPage";
import { albumMeta, filterAlbums, isCollagesAlbum, plural } from "./albums/albumsFormat";

interface AlbumsViewProps {
  onLockAlbumToVault?: (albumId: number, isVault?: boolean) => void | Promise<void>;
  onPhotoClick?: (idx: number, albumPhotos: PhotoItem[]) => void;
  onToggleFavorite?: (photoId: number) => void;
  onPlayStory?: (storyId: number) => void;
  importProgress?: ImportProgressState | null;
}

const Cover: React.FC<{ photoId?: number | null; className: string; icon?: React.ReactNode }> = ({ photoId, className, icon }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={className}>
      {photoId && !failed ? (
        <img src={getThumbnailUrl(photoId)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="alb-cover-empty" aria-hidden="true">
          {icon ?? <Images size={22} />}
        </span>
      )}
    </span>
  );
};

export const AlbumsView: React.FC<AlbumsViewProps> = ({ onLockAlbumToVault, onPhotoClick, onToggleFavorite, onPlayStory, importProgress }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [albums, setAlbums] = useState<AlbumItem[] | null>(null);
  const [favourites, setFavourites] = useState<{ count: number; coverId: number | null }>({ count: 0, coverId: null });
  const [stories, setStories] = useState<StoryModel[]>([]);
  const [page, setPage] = useState<AlbumPageTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const json = async <T,>(path: string): Promise<T | null> => {
      try {
        const res = await apiFetch(path);
        return res.ok ? ((await res.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [a, f, s] = await Promise.all([
      json<AlbumItem[]>("/api/albums"),
      json<PhotoItem[]>("/api/photos?favorite_only=true"),
      json<StoryModel[]>("/api/stories?saved_only=true"),
    ]);
    setAlbums(Array.isArray(a) ? a : []);
    if (Array.isArray(f)) setFavourites({ count: f.length, coverId: f[0]?.id ?? null });
    if (Array.isArray(s)) setStories(s);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onStories = () => {
      apiFetch("/api/stories?saved_only=true")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => Array.isArray(data) && setStories(data))
        .catch(() => {});
    };
    window.addEventListener("stories-changed", onStories);
    return () => window.removeEventListener("stories-changed", onStories);
  }, []);

  // When an import into the library finishes, counts and the open album may have changed.
  const wasImporting = useRef(false);
  useEffect(() => {
    if (wasImporting.current && !importProgress?.is_active) {
      load();
      setRefreshKey((k) => k + 1);
    }
    wasImporting.current = !!importProgress?.is_active;
  }, [importProgress?.is_active, load]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const collages = useMemo(() => (albums ?? []).find(isCollagesAlbum), [albums]);
  const own = useMemo(() => (albums ?? []).filter((a) => !isCollagesAlbum(a)), [albums]);
  const shown = useMemo(() => filterAlbums(own, query), [own, query]);

  const createAlbum = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await apiFetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "");
      setCreating(false);
      setNewName("");
      setAlbums((prev) => [data as AlbumItem, ...(prev ?? [])]);
      setPage({ kind: "album", album: data as AlbumItem });
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "The album couldn't be created. Try again.", "warning");
    }
  };

  if (page) {
    return (
      <AlbumPage
        key={page.kind === "album" ? `album-${page.album.id}` : page.kind}
        target={page}
        savedStories={stories}
        refreshKey={refreshKey}
        onBack={() => {
          setPage(null);
          load();
        }}
        onChanged={load}
        onPhotoClick={onPhotoClick}
        onToggleFavorite={onToggleFavorite}
        onPlayStory={onPlayStory}
        onLockAlbumToVault={onLockAlbumToVault}
      />
    );
  }

  return (
    <div className="alb-page">
      <div className="dash-header">
        <h1 className="dash-title">Albums</h1>
        <span className="dash-subtitle">{albums ? plural(own.length, "album") : ""}</span>
        <div style={{ flex: 1 }} />
        {searching ? (
          <span className="alb-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="Search albums"
              placeholder="Album name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => {
                setQuery("");
                setSearching(false);
              }}
            >
              <X size={14} />
            </button>
          </span>
        ) : (
          own.length > 0 && (
            <button type="button" className="dash-icon-btn" aria-label="Search albums" title="Search albums" onClick={() => setSearching(true)}>
              <Search size={16} />
            </button>
          )
        )}
        <button type="button" className="dash-btn dash-btn-primary" onClick={() => setCreating(true)}>
          + New album
        </button>
      </div>

      {creating && (
        <form
          className="dash-note dash-note-row alb-new"
          onSubmit={(e) => {
            e.preventDefault();
            createAlbum();
          }}
        >
          <input
            aria-label="New album name"
            placeholder="Name the album, e.g. Goa 2026"
            value={newName}
            autoFocus
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
          />
          <button type="submit" className="dash-btn dash-btn-primary dash-btn-small" disabled={!newName.trim()}>
            Create
          </button>
          <button
            type="button"
            className="dash-btn dash-btn-small"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            Cancel
          </button>
        </form>
      )}

      <section className="alb-section" aria-labelledby="alb-for-you">
        <h2 id="alb-for-you" className="dash-section-title">
          Made for you
        </h2>
        <div className="alb-foryou">
          <button type="button" className="alb-foryou-card" onClick={() => setPage({ kind: "favourites" })}>
            <Cover photoId={favourites.coverId} className="alb-foryou-cover" icon={<Heart size={20} />} />
            <span className="alb-foryou-text">
              <span className="alb-cover-name">Favourites</span>
              <span className="dash-muted">{plural(favourites.count, "photo")}</span>
            </span>
          </button>
          <button type="button" className="alb-foryou-card" onClick={() => setPage({ kind: "stories" })}>
            <Cover photoId={stories[0]?.cover_photo_id} className="alb-foryou-cover" icon={<Play size={20} />} />
            <span className="alb-foryou-text">
              <span className="alb-cover-name">Saved stories</span>
              <span className="dash-muted">{plural(stories.length, "story", "stories")}</span>
            </span>
          </button>
          {collages && (
            <button type="button" className="alb-foryou-card" onClick={() => setPage({ kind: "album", album: collages })}>
              <Cover photoId={collages.cover_photo_id} className="alb-foryou-cover" />
              <span className="alb-foryou-text">
                <span className="alb-cover-name">Collages</span>
                <span className="dash-muted">{plural(collages.photo_count ?? 0, "collage")}</span>
              </span>
            </button>
          )}
        </div>
      </section>

      <section className="alb-section" aria-labelledby="alb-yours">
        <h2 id="alb-yours" className="dash-section-title">
          Your albums
        </h2>
        {albums === null ? null : own.length === 0 ? (
          <div className="dash-empty">
            <FolderPlus size={26} aria-hidden="true" />
            <h2>No albums yet</h2>
            <p>Group photos into albums, like a trip or a birthday. Photos stay in your library too.</p>
            <button type="button" className="dash-btn dash-btn-primary" onClick={() => setCreating(true)}>
              + New album
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="dash-muted">No album is called "{query.trim()}".</p>
        ) : (
          <div className="alb-covers">
            {shown.map((album) => (
              <button key={album.id} type="button" className="alb-cover-card" onClick={() => setPage({ kind: "album", album })}>
                <Cover photoId={album.photo_count ? album.cover_photo_id : null} className="alb-cover" />
                <span className="alb-cover-name">{album.name}</span>
                <span className="dash-muted">{albumMeta(album)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
