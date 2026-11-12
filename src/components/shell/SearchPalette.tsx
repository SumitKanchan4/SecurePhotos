/**
 * SearchPalette: the global search (Ctrl+K), shown as a centred panel (redesign R1).
 *
 * The input and the live results (people, albums, photos, quick filters) are the
 * former title-bar search, moved here unchanged. The query stays in the store's
 * `searchQuery`, which also filters People, Albums, Documents and Trash; the
 * window strip shows it as a chip while the palette is closed.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  Star,
  Film,
  FileText,
  Calendar,
  Users,
  Folder,
  ArrowRight,
  Loader2,
  Sparkles,
  User,
  Image as ImageIcon
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { SearchResponse, SearchPhotoItem, SearchAlbumItem, SearchPersonItem } from "../../types";
import { apiFetch, getApiUrl } from "../../services/api";

interface SearchPaletteProps {
  onSelectPhoto?: (photo: SearchPhotoItem, allPhotos: SearchPhotoItem[]) => void;
}

export const SearchPalette: React.FC<SearchPaletteProps> = ({ onSelectPhoto }) => {
  const {
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    isSearchOpen,
    setSearchOpen,
  } = useAppStore();

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const getSearchPlaceholder = () => {
    if (activeTab === "people") {
      return "Search people by name or relationship... (Ctrl+K)";
    }
    if (activeTab === "albums") {
      return "Search albums by title... (Ctrl+K)";
    }
    if (activeTab === "documents") {
      return "Search documents by OCR text, category, or title... (Ctrl+K)";
    }
    if (activeTab === "trash") {
      return "Search items in trash... (Ctrl+K)";
    }
    return "Search photos, people, tags, OCR documents... (Ctrl+K)";
  };

  // Ctrl+K / Cmd+K opens the search palette; Escape closes it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape" && useAppStore.getState().isSearchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  // Focus and select the query whenever the palette opens.
  useEffect(() => {
    if (isSearchOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isSearchOpen]);


  // Debounced live search query execution
  const fetchSearchResults = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data);
      }
    } catch (err) {
      console.warn("Search query error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      fetchSearchResults(trimmed);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchSearchResults]);

  const handleQuickFilterClick = (filterKeyword: string) => {
    setSearchQuery(filterKeyword);
    setActiveTab("photos");
    setSearchOpen(false);
  };

  const handlePersonClick = (person: SearchPersonItem) => {
    setActiveTab("people");
    setSearchQuery(person.name);
    setSearchOpen(false);
  };

  const handleAlbumClick = (album: SearchAlbumItem) => {
    setActiveTab("albums");
    setSearchQuery(album.name);
    setSearchOpen(false);
  };

  const handlePhotoClick = (photo: SearchPhotoItem) => {
    if (onSelectPhoto && results?.photos) {
      onSelectPhoto(photo, results.photos);
    }
    setActiveTab("photos");
    setSearchOpen(false);
  };

  const handleViewAllPhotos = () => {
    setActiveTab("photos");
    setSearchOpen(false);
  };

  if (!isSearchOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search your library"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSearchOpen(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
      }}
    >
      <div
        ref={searchContainerRef}
        style={{ width: "min(640px, 92vw)", display: "flex", flexDirection: "column", gap: "10px" }}
      >
        <div 
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: isSearchOpen ? "var(--bg-surface-elevated)" : "var(--glass-pill-bg)",
            borderRadius: "var(--radius-full)",
            border: isSearchOpen 
              ? "1px solid var(--accent-primary)" 
              : "1px solid var(--glass-pill-border)",
            padding: "4px 12px",
            gap: "8px",
            boxShadow: isSearchOpen ? "0 0 0 2px color-mix(in srgb, var(--accent-ink) 20%, transparent)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          {isLoading ? (
            <Loader2 size={14} className="spin" style={{ color: "var(--accent-primary)" }} />
          ) : (
            <Search size={14} style={{ color: "var(--text-muted)" }} />
          )}

          <input
            ref={inputRef}
            type="text"
            placeholder={getSearchPlaceholder()}
            value={searchQuery}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!isSearchOpen) setSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearchOpen(false);
                if (activeTab !== "people" && activeTab !== "albums" && activeTab !== "documents" && activeTab !== "trash") {
                  setActiveTab("photos");
                }
              }
            }}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontFamily: "var(--font-sans)",
            }}
          />

          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setResults(null);
                inputRef.current?.focus();
              }}
              title="Clear search"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                padding: "2px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={13} />
            </button>
          ) : (
            <kbd 
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                padding: "1px 5px",
                borderRadius: "var(--radius-xs)",
                backgroundColor: "var(--bg-surface-elevated)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              Ctrl K
            </kbd>
          )}
        </div>
          <div
            style={{
              backgroundColor: "var(--bg-surface-elevated)",
              border: "1px solid var(--glass-border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 18px 45px rgba(0, 0, 0, 0.35)",
              padding: "14px",
              maxHeight: "60vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            {/* Case 1: Empty Query - Show Quick Categories & Search Guidance */}
            {!searchQuery.trim() && (
              <div>
                <div 
                  style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: "6px", 
                    fontSize: "11px", 
                    fontWeight: 700, 
                    color: "var(--text-muted)", 
                    textTransform: "uppercase", 
                    letterSpacing: "0.5px",
                    marginBottom: "10px",
                  }}
                >
                  <Sparkles size={12} style={{ color: "var(--accent-primary)" }} />
                  <span>Quick Categories</span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  <button
                    onClick={() => handleQuickFilterClick("favorites")}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <Star size={12} style={{ color: "#f59e0b" }} />
                    <span>Favorites</span>
                  </button>

                  <button
                    onClick={() => handleQuickFilterClick("videos")}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <Film size={12} style={{ color: "var(--accent-ink)" }} />
                    <span>Videos</span>
                  </button>

                  <button
                    onClick={() => handleQuickFilterClick("documents")}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <FileText size={12} style={{ color: "#10b981" }} />
                    <span>Documents & Receipts</span>
                  </button>

                  <button
                    onClick={() => handleQuickFilterClick("2026")}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <Calendar size={12} style={{ color: "#8b5cf6" }} />
                    <span>Year 2026</span>
                  </button>

                  <button
                    onClick={() => handleQuickFilterClick("2025")}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-pill-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    <Calendar size={12} style={{ color: "#8b5cf6" }} />
                    <span>Year 2025</span>
                  </button>
                </div>

                <div 
                  style={{ 
                    marginTop: "12px", 
                    paddingTop: "10px", 
                    borderTop: "1px solid var(--border-subtle)", 
                    fontSize: "11px", 
                    color: "var(--text-muted)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>Search captions, filenames, people, and text in photos</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }}>Press Enter to search</span>
                </div>
              </div>
            )}

            {/* Case 2: Loading query */}
            {searchQuery.trim() && isLoading && !results && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "16px", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                <Loader2 size={16} className="spin" style={{ color: "var(--accent-primary)" }} />
                <span>Searching your collection...</span>
              </div>
            )}

            {/* Case 3: Results Found */}
            {searchQuery.trim() && results && (
              <>
                {/* 1. People Matches */}
                {results.people.length > 0 && (
                  <div>
                    <div 
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "6px", 
                        fontSize: "11px", 
                        fontWeight: 700, 
                        color: "var(--text-muted)", 
                        textTransform: "uppercase", 
                        letterSpacing: "0.5px",
                        marginBottom: "8px",
                      }}
                    >
                      <Users size={12} style={{ color: "var(--accent-primary)" }} />
                      <span>People ({results.people.length})</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {results.people.map((person) => (
                        <div
                          key={person.id}
                          onClick={() => handlePersonClick(person)}
                          className="clickable"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "6px 10px",
                            borderRadius: "var(--radius-md)",
                            backgroundColor: "var(--bg-surface-elevated)",
                            border: "1px solid var(--border-subtle)",
                            transition: "background-color 0.15s ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div 
                              style={{ 
                                width: "28px", 
                                height: "28px", 
                                borderRadius: "var(--radius-full)", 
                                overflow: "hidden", 
                                backgroundColor: "var(--glass-pill-bg)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {person.cover_face_id ? (
                                <img 
                                  src={getApiUrl(`/api/people/faces/${person.cover_face_id}/crop`)} 
                                  alt={person.name}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <User size={14} style={{ color: "var(--text-muted)" }} />
                              )}
                            </div>
                            <div>
                              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
                                {person.name}
                              </div>
                              {person.relationship_type && (
                                <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                                  {person.relationship_type}
                                </div>
                              )}
                            </div>
                          </div>

                          <span 
                            style={{ 
                              fontSize: "11px", 
                              color: "var(--text-muted)", 
                              fontFamily: "var(--font-mono)",
                              backgroundColor: "var(--glass-badge-bg)",
                              padding: "2px 6px",
                              borderRadius: "var(--radius-full)",
                            }}
                          >
                            {person.confirmed_count} {person.confirmed_count === 1 ? "photo" : "photos"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Albums Matches */}
                {results.albums.length > 0 && (
                  <div>
                    <div 
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "6px", 
                        fontSize: "11px", 
                        fontWeight: 700, 
                        color: "var(--text-muted)", 
                        textTransform: "uppercase", 
                        letterSpacing: "0.5px",
                        marginBottom: "8px",
                      }}
                    >
                      <Folder size={12} style={{ color: "var(--accent-primary)" }} />
                      <span>Albums ({results.albums.length})</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {results.albums.map((album) => (
                        <div
                          key={album.id}
                          onClick={() => handleAlbumClick(album)}
                          className="clickable"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "6px 10px",
                            borderRadius: "var(--radius-md)",
                            backgroundColor: "var(--bg-surface-elevated)",
                            border: "1px solid var(--border-subtle)",
                            transition: "background-color 0.15s ease",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div 
                              style={{ 
                                width: "28px", 
                                height: "28px", 
                                borderRadius: "var(--radius-sm)", 
                                overflow: "hidden", 
                                backgroundColor: "var(--glass-pill-bg)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {album.cover_photo_id ? (
                                <img 
                                  src={getApiUrl(`/api/photos/${album.cover_photo_id}/thumbnail?v=3`)} 
                                  alt={album.name}
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                              ) : (
                                <Folder size={14} style={{ color: "var(--accent-primary)" }} />
                              )}
                            </div>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
                              {album.name}
                            </span>
                          </div>

                          <span 
                            style={{ 
                              fontSize: "11px", 
                              color: "var(--text-muted)", 
                              fontFamily: "var(--font-mono)",
                              backgroundColor: "var(--glass-badge-bg)",
                              padding: "2px 6px",
                              borderRadius: "var(--radius-full)",
                            }}
                          >
                            {album.photo_count} {album.photo_count === 1 ? "photo" : "photos"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Photos Matches */}
                {results.photos.length > 0 && (
                  <div>
                    <div 
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between",
                        fontSize: "11px", 
                        fontWeight: 700, 
                        color: "var(--text-muted)", 
                        textTransform: "uppercase", 
                        letterSpacing: "0.5px",
                        marginBottom: "8px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <ImageIcon size={12} style={{ color: "var(--accent-primary)" }} />
                        <span>Photos & Videos ({results.total_photos})</span>
                      </div>

                      {results.total_photos > 6 && (
                        <button
                          onClick={handleViewAllPhotos}
                          className="clickable"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--accent-primary)",
                            fontSize: "11px",
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            cursor: "pointer",
                          }}
                        >
                          View all in gallery <ArrowRight size={11} />
                        </button>
                      )}
                    </div>

                    <div 
                      style={{ 
                        display: "grid", 
                        gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", 
                        gap: "6px",
                      }}
                    >
                      {results.photos.slice(0, 6).map((photo) => (
                        <div
                          key={photo.id}
                          onClick={() => handlePhotoClick(photo)}
                          className="clickable"
                          title={`${photo.filename}${photo.match_reason ? ` (${photo.match_reason})` : ""}`}
                          style={{
                            aspectRatio: "1",
                            borderRadius: "var(--radius-sm)",
                            overflow: "hidden",
                            position: "relative",
                            border: "1px solid var(--border-subtle)",
                            backgroundColor: "var(--bg-surface-elevated)",
                          }}
                        >
                          <img
                            src={getApiUrl(`/api/photos/${photo.id}/thumbnail?v=3`)}
                            alt={photo.filename}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            onError={(e) => {
                              (e.target as HTMLElement).style.opacity = "0.2";
                            }}
                          />
                          {photo.match_reason && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: "2px",
                                left: "2px",
                                right: "2px",
                                backgroundColor: "rgba(0, 0, 0, 0.7)",
                                color: "#ffffff",
                                fontSize: "8px",
                                fontWeight: 600,
                                padding: "1px 3px",
                                borderRadius: "2px",
                                textOverflow: "ellipsis",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textAlign: "center",
                              }}
                            >
                              {photo.match_reason}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. No Results Found */}
                {results.people.length === 0 && results.albums.length === 0 && results.photos.length === 0 && (
                  <div style={{ textAlign: "center", padding: "20px 10px", color: "var(--text-secondary)" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
                      No matches found for "{searchQuery}"
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "340px", margin: "0 auto" }}>
                      Private vault media and deleted items are protected and excluded from search.
                    </div>

                    {results.suggestions && results.suggestions.length > 0 && (
                      <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
                        {results.suggestions.map((s) => (
                          <button
                            key={s}
                            onClick={() => handleQuickFilterClick(s.toLowerCase())}
                            className="clickable"
                            style={{
                              padding: "3px 8px",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: "var(--glass-pill-bg)",
                              border: "1px solid var(--glass-pill-border)",
                              color: "var(--text-primary)",
                              fontSize: "10px",
                              fontWeight: 500,
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
      </div>
    </div>
  );
};
