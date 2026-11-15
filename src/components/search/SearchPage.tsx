/**
 * Search (R9c, owner choice): its own section instead of a box that popped up over every
 * screen. A big field on top; before typing, people, albums and quick searches to start from;
 * after typing, matching people and albums, then the photos and videos in the photo grid.
 * Clicking a person or album opens their page directly.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import type { AlbumItem, PersonItem, SearchAlbumItem, SearchPersonItem, SearchResponse, TimelinePhoto } from "../../types";
import { useAppStore } from "../../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../../services/api";
import { PhotoTimeline } from "../photos/PhotoTimeline";
import { Face } from "../people/PeopleOverview";
import { quickSearches, resultsLabel, toTimeline } from "./searchFormat";

const PAGE = 200;
const MAX_RESULTS = 2000;

interface SearchPageProps {
  onOpenPhoto: (photos: TimelinePhoto[], index: number) => void;
  onToggleFavorite?: (id: number) => void;
}

type PersonChip = Pick<SearchPersonItem, "id" | "name" | "cover_face_id"> & { count: number };
type AlbumChip = Pick<SearchAlbumItem, "id" | "name" | "cover_photo_id"> & { count: number };

const PeopleRow: React.FC<{ people: PersonChip[]; onOpen: (id: number) => void }> = ({ people, onOpen }) => (
  <div className="search-people">
    {people.map((p) => (
      <button key={p.id} type="button" className="search-person" onClick={() => onOpen(p.id)} title={`Open ${p.name}`}>
        <Face faceId={p.cover_face_id} name={p.name} size={64} />
        <span className="search-person-name">{p.name}</span>
        <span className="dash-muted">{p.count === 1 ? "1 photo" : `${p.count.toLocaleString()} photos`}</span>
      </button>
    ))}
  </div>
);

const AlbumsRow: React.FC<{ albums: AlbumChip[]; onOpen: (id: number) => void }> = ({ albums, onOpen }) => (
  <div className="search-albums">
    {albums.map((a) => (
      <button key={a.id} type="button" className="search-album" onClick={() => onOpen(a.id)}>
        <span className="search-album-cover">{a.cover_photo_id ? <img src={getThumbnailUrl(a.cover_photo_id)} alt="" loading="lazy" draggable={false} /> : null}</span>
        <span className="search-album-text">
          <span className="alb-cover-name">{a.name}</span>
          <span className="dash-muted">{a.count === 1 ? "1 photo" : `${a.count.toLocaleString()} photos`}</span>
        </span>
      </button>
    ))}
  </div>
);

export const SearchPage: React.FC<SearchPageProps> = ({ onOpenPhoto, onToggleFavorite }) => {
  const { searchQuery, setSearchQuery, searchFocusKey, openPerson, openAlbum } = useAppStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<{ query: string; data: SearchResponse; photos: TimelinePhoto[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<PersonChip[]>([]);
  const [albums, setAlbums] = useState<AlbumChip[]>([]);
  const query = searchQuery.trim();

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [searchFocusKey]);

  // Starting points before anything is typed.
  useEffect(() => {
    apiFetch("/api/people")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: PersonItem[]) =>
        setPeople(
          (Array.isArray(data) ? data : [])
            .filter((p) => p.name)
            .slice(0, 12)
            .map((p) => ({ id: p.id, name: p.name, cover_face_id: p.cover_face_id, count: p.confirmed_count })),
        ),
      )
      .catch(() => {});
    apiFetch("/api/albums")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: AlbumItem[]) =>
        setAlbums(
          (Array.isArray(data) ? data : [])
            .filter((a) => !a.is_vault && (a.photo_count ?? 0) > 0)
            .slice(0, 8)
            .map((a) => ({ id: a.id, name: a.name, cover_photo_id: a.cover_photo_id, count: a.photo_count ?? 0 })),
        ),
      )
      .catch(() => {});
  }, []);

  // Search as you type (after a short pause), loading every match in pages.
  useEffect(() => {
    if (!query) {
      setResults(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        let data: SearchResponse | null = null;
        const all: SearchResponse["photos"] = [];
        for (let offset = 0; offset < MAX_RESULTS; offset += PAGE) {
          const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&limit=${PAGE}&offset=${offset}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const page: SearchResponse = await res.json();
          if (!alive) return;
          data = data ?? page;
          all.push(...page.photos);
          if (page.photos.length < PAGE || all.length >= page.total_photos) break;
        }
        if (alive && data) setResults({ query, data, photos: toTimeline(all) });
      } catch {
        if (alive) setResults({ query, data: { query, total_photos: 0, photos: [], albums: [], people: [], suggestions: [] }, photos: [] });
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const matchedPeople = useMemo<PersonChip[]>(
    () => (results?.data.people ?? []).map((p) => ({ id: p.id, name: p.name, cover_face_id: p.cover_face_id, count: p.confirmed_count })),
    [results],
  );
  const matchedAlbums = useMemo<AlbumChip[]>(
    () => (results?.data.albums ?? []).map((a) => ({ id: a.id, name: a.name, cover_photo_id: a.cover_photo_id, count: a.photo_count })),
    [results],
  );
  const shownFor = results?.query === query ? results : null;

  return (
    <div className="search-page">
      <div className="search-top">
        <h1 className="dash-title">Search</h1>
        <label className="search-field">
          {loading ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
          <input
            ref={inputRef}
            type="search"
            aria-label="Search your library"
            placeholder="People, places, things, text in photos, a year…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery) {
                e.stopPropagation();
                setSearchQuery("");
              }
            }}
          />
          {searchQuery && (
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearchQuery("")}>
              <X size={16} />
            </button>
          )}
        </label>

        {!query ? (
          <>
            <section className="search-section" aria-labelledby="search-try">
              <h2 id="search-try" className="dash-section-title">
                Try
              </h2>
              <div className="search-chips">
                {quickSearches().map((q) => (
                  <button key={q.query} type="button" className="search-chip" onClick={() => setSearchQuery(q.query)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </section>
            {people.length > 0 && (
              <section className="search-section" aria-labelledby="search-people">
                <h2 id="search-people" className="dash-section-title">
                  People
                </h2>
                <PeopleRow people={people} onOpen={openPerson} />
              </section>
            )}
            {albums.length > 0 && (
              <section className="search-section" aria-labelledby="search-albums">
                <h2 id="search-albums" className="dash-section-title">
                  Albums
                </h2>
                <AlbumsRow albums={albums} onOpen={openAlbum} />
              </section>
            )}
            <p className="dash-muted search-hint">Private Vault items and Trash are never searched.</p>
          </>
        ) : (
          shownFor && (
            <>
              {matchedPeople.length > 0 && (
                <section className="search-section" aria-labelledby="search-people">
                  <h2 id="search-people" className="dash-section-title">
                    People
                  </h2>
                  <PeopleRow people={matchedPeople} onOpen={openPerson} />
                </section>
              )}
              {matchedAlbums.length > 0 && (
                <section className="search-section" aria-labelledby="search-albums">
                  <h2 id="search-albums" className="dash-section-title">
                    Albums
                  </h2>
                  <AlbumsRow albums={matchedAlbums} onOpen={openAlbum} />
                </section>
              )}
              <h2 className="dash-section-title" role="status">
                {shownFor.data.total_photos > 0 ? resultsLabel(shownFor.data.total_photos) : `Nothing matches "${query}"`}
              </h2>
              {shownFor.data.total_photos === 0 && (
                <p className="dash-muted search-hint">
                  Try a name, a place, a word from a document, a year like 2024, or Videos or Favourites.
                </p>
              )}
            </>
          )
        )}
      </div>

      {query && shownFor && shownFor.photos.length > 0 && (
        <div className="search-results">
          <PhotoTimeline
            photos={shownFor.photos}
            onOpen={(index) => onOpenPhoto(shownFor.photos, index)}
            onToggleFavorite={onToggleFavorite}
            selectable={false}
          />
        </div>
      )}
    </div>
  );
};
