import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  Users, 
  Check,
  Star,
  ArrowLeft,
  Image as ImageIcon,
  Heart,
  Loader2,
  Tag,
  X,
  Play,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Trash2,
  UserMinus,
  Eye,
} from "lucide-react";
import { PersonItem, UnlabeledClusterItem, FaceScanStatus, PhotoItem } from "../types";
import { AlbumSlideshowModal } from "./AlbumSlideshowModal";
import { useAppStore } from "../store/useAppStore";
import { PeopleOverview } from "./people/PeopleOverview";
import { apiFetch, getApiUrl } from "../services/api";

export const RELATIONSHIP_OPTIONS = [
  "Family",
  "Friends",
  "Relatives",
  "Colleagues",
  "Acquaintances",
];

// Priority hierarchy for organizing and surfacing recognized people (Family=10, Friends=8, Relatives=6, Colleagues=4, Acquaintances=2)
export const RELATION_PRIORITY: Record<string, number> = {
  "Family": 10,
  "Friends": 8,
  "Relatives": 6,
  "Colleagues": 4,
  "Acquaintances": 2,
  // Backwards compatibility fallbacks
  "Spouse": 10,
  "Child": 10,
  "Parent": 10,
  "Sibling": 10,
  "Extended Family": 6,
  "Friend": 8,
  "Relative": 6,
  "Colleague": 4,
  "Acquaintance": 2,
};

export interface PeopleViewProps {
  onPhotoClick?: (idx: number, photos: PhotoItem[]) => void;
  onToggleFavorite?: (photoId: number) => void;
}

export const PeopleView: React.FC<PeopleViewProps> = ({
  onPhotoClick,
  onToggleFavorite,
}) => {
  const [people, setPeople] = useState<PersonItem[]>([]);
  const [unlabeledClusters, setUnlabeledClusters] = useState<UnlabeledClusterItem[]>([]);
  const [scanStatus, setScanStatus] = useState<FaceScanStatus>({
    is_scanning: false,
    total_photos: 0,
    scanned_photos: 0,
    faces_found: 0,
    current_photo: null,
    error: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [isResetting, setIsResetting] = useState<boolean>(false);
  // Selected person detail view (viewing photos of a person)
  const [selectedPerson, setSelectedPerson] = useState<PersonItem | null>(null);
  const [personPhotos, setPersonPhotos] = useState<PhotoItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(false);
  const [updatingPerson, setUpdatingPerson] = useState<boolean>(false);
  // Rename on the person page (moved here from the removed "See all" dialog, redesign R5).
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const showToast = useAppStore((state) => state.showToast);
  const [isSlideshowOpen, setIsSlideshowOpen] = useState<boolean>(false);
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [lastClickedYear, setLastClickedYear] = useState<string | null>(null);
  const [isRangePopoverOpen, setIsRangePopoverOpen] = useState<boolean>(false);
  const [customRangeFrom, setCustomRangeFrom] = useState<string>("");
  const [customRangeTo, setCustomRangeTo] = useState<string>("");
  const [isRelationshipPopoverOpen, setIsRelationshipPopoverOpen] = useState<boolean>(false);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);

  // Face inspection preview modal (resolves overlapping/kissing faces)
  const [inspectingFaceId, setInspectingFaceId] = useState<number | null>(null);
  const [inspectingFaceData, setInspectingFaceData] = useState<{
    id: number;
    photo_id: number;
    box_x: number;
    box_y: number;
    box_w: number;
    box_h: number;
    quality_score: number;
    filename: string;
  } | null>(null);
  const [loadingInspectFace, setLoadingInspectFace] = useState<boolean>(false);

  // Load recognized people
  const fetchPeople = useCallback(async () => {
    try {
      const res = await apiFetch("/api/people");
      if (res.ok) {
        const data: PersonItem[] = await res.json();
        setPeople(data);
      }
    } catch (err) {
      console.error("Failed to fetch people:", err);
    }
  }, []);

  // Load unsupervised clusters
  const fetchClusters = useCallback(async () => {
    try {
      const res = await apiFetch("/api/people/clusters");
      if (res.ok) {
        const data: UnlabeledClusterItem[] = await res.json();
        setUnlabeledClusters(data);
      }
    } catch (err) {
      console.error("Failed to fetch face clusters:", err);
    }
  }, []);

  // Poll scan progress
  const checkScanStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/people/scan-progress");
      if (res.ok) {
        const data: FaceScanStatus = await res.json();
        setScanStatus(data);
        return data.is_scanning;
      }
    } catch (err) {
      console.error("Failed to check face scan status:", err);
    }
    return false;
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchPeople(), fetchClusters(), checkScanStatus()]);
      setIsLoading(false);
    };
    init();
  }, [fetchPeople, fetchClusters, checkScanStatus]);

  // Polling loop while face scan is in progress
  useEffect(() => {
    if (!scanStatus.is_scanning) return;

    const interval = setInterval(async () => {
      const stillScanning = await checkScanStatus();
      if (!stillScanning) {
        // Refresh data once scan completes
        await Promise.all([fetchPeople(), fetchClusters()]);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [scanStatus.is_scanning, checkScanStatus, fetchPeople, fetchClusters]);

  // Listen for global photo lifecycle changes (deletion, trash, restore, import)
  useEffect(() => {
    const handlePhotosChanged = (e?: Event) => {
      fetchPeople();
      fetchClusters();
      if (selectedPerson) {
        const detail = (e as CustomEvent)?.detail;
        if (detail?.photoId) {
          setPersonPhotos((prev) => prev.filter((p) => p.id !== detail.photoId));
        }
      }
    };

    window.addEventListener("photos-changed", handlePhotosChanged);
    return () => {
      window.removeEventListener("photos-changed", handlePhotosChanged);
    };
  }, [fetchPeople, fetchClusters, selectedPerson]);

  // Trigger manual face scan
  const handleTriggerScan = async () => {
    try {
      const res = await apiFetch("/api/people/scan", { method: "POST" });
      if (res.ok) {
        const statusData: FaceScanStatus = await res.json();
        setScanStatus(statusData);
        if (!statusData.is_scanning) {
          await Promise.all([fetchPeople(), fetchClusters()]);
        }
      }
    } catch (err) {
      console.error("Failed to trigger face scan:", err);
    }
  };

  // Inspect face in context of full photo with glowing bounding box
  const handleInspectFace = async (faceId: number) => {
    setInspectingFaceId(faceId);
    setLoadingInspectFace(true);
    try {
      const res = await apiFetch(`/api/people/faces/${faceId}`);
      if (res.ok) {
        const data = await res.json();
        setInspectingFaceData(data);
      }
    } catch (err) {
      console.error("Failed to load face details:", err);
    } finally {
      setLoadingInspectFace(false);
    }
  };

  // Unlink a single mis-tagged photo from a recognized person
  const handleUnlinkPhoto = async (personId: number, photoId: number) => {
    try {
      const res = await apiFetch(`/api/people/${personId}/unlink-photo/${photoId}`, {
        method: "POST",
      });
      if (res.ok) {
        setPersonPhotos((prev) => prev.filter((p) => p.id !== photoId));
        await fetchPeople();
      }
    } catch (err) {
      console.error("Failed to unlink photo:", err);
    }
  };

  // Safely delete a person identity without deleting source photos
  const handleDeletePerson = async (personId: number) => {
    if (!confirm(`Are you sure you want to delete "${selectedPerson?.name}"? All photos will remain safely in your library.`)) {
      return;
    }
    try {
      const res = await apiFetch(`/api/people/${personId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedPerson(null);
        setPersonPhotos([]);
        await fetchPeople();
        await fetchClusters();
      }
    } catch (err) {
      console.error("Failed to delete person:", err);
    }
  };

  // View photos of a specific person
  const handleSelectPerson = async (person: PersonItem) => {
    setSelectedPerson(person);
    setLoadingPhotos(true);
    setPersonFilter("all");
    setSelectedYears([]);
    setLastClickedYear(null);
    setIsRangePopoverOpen(false);
    try {
      const res = await apiFetch(`/api/people/${person.id}/photos`);
      if (res.ok) {
        const photos: PhotoItem[] = await res.json();
        setPersonPhotos(photos);
      }
    } catch (err) {
      console.error("Failed to fetch person photos:", err);
    } finally {
      setLoadingPhotos(false);
    }
  };

  // Update a person's relationship, name, or Close One status
  const handleUpdatePerson = async (personId: number, updates: { name?: string; relationship_type?: string; is_close_one?: boolean }) => {
    setUpdatingPerson(true);
    try {
      const res = await apiFetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (res.ok) {
        const updated: PersonItem = await res.json();
        setSelectedPerson((prev) => (prev && prev.id === personId ? updated : prev));
        setPeople((prev) => prev.map((p) => (p.id === personId ? updated : p)));
      }
    } catch (err) {
      console.error("Failed to update person:", err);
    } finally {
      setUpdatingPerson(false);
    }
  };

  const commitRename = async () => {
    if (!selectedPerson || renameDraft === null) return;
    const name = renameDraft.trim();
    setRenameDraft(null);
    if (!name || name === selectedPerson.name) return;
    const taken = people.find((p) => p.id !== selectedPerson.id && p.name.trim().toLowerCase() === name.toLowerCase());
    if (taken) {
      showToast(`Someone else is already called ${taken.name}. Pick a different name.`, "warning");
      return;
    }
    await handleUpdatePerson(selectedPerson.id, { name });
  };

  // Reset all face identification to start over fresh
  const handleResetFaces = async () => {
    if (!window.confirm("Are you sure you want to reset all face identification? This will clear all recognized people and clusters so you can start over fresh. Your photos will remain 100% safe.")) {
      return;
    }
    setIsResetting(true);
    try {
      const res = await apiFetch("/api/people/reset", { method: "POST" });
      if (res.ok) {
        setSelectedPerson(null);
        await Promise.all([fetchPeople(), fetchClusters(), checkScanStatus()]);
      }
    } catch (err) {
      console.error("Failed to reset face identification:", err);
    } finally {
      setIsResetting(false);
    }
  };

  // Sort recognized people by relationship priority (Family=10, Friends=8, Relatives=6), then photo count, then name
  const sortedPeople = [...people].sort((a, b) => {
    const prioA = RELATION_PRIORITY[a.relationship_type || ""] || (a.is_close_one ? 5.5 : 1);
    const prioB = RELATION_PRIORITY[b.relationship_type || ""] || (b.is_close_one ? 5.5 : 1);
    if (prioB !== prioA) return prioB - prioA;
    if (b.confirmed_count !== a.confirmed_count) return b.confirmed_count - a.confirmed_count;
    return a.name.localeCompare(b.name);
  });

  // Computed values for selectedPerson drill-down
  const { availableYears, favCount, timelineGroups } = useMemo(() => {
    if (!selectedPerson || personPhotos.length === 0) {
      return {
        availableYears: [] as string[],
        favCount: 0,
        timelineGroups: [] as [string, PhotoItem[]][],
      };
    }

    const yearsSet = new Set<string>();
    let favorites = 0;
    for (const p of personPhotos) {
      if (p.is_favorite) favorites++;
      if (p.taken_at) {
        const y = p.taken_at.slice(0, 4);
        if (/^\d{4}$/.test(y)) yearsSet.add(y);
      }
    }
    const years = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));

    // Filter by personFilter ('all' | 'favorites' | 'years')
    let filtered = personPhotos;
    if (personFilter === "favorites") {
      filtered = personPhotos.filter((p) => p.is_favorite);
    } else if (personFilter === "years" && selectedYears.length > 0) {
      const yearSet = new Set(selectedYears);
      filtered = personPhotos.filter((p) => {
        if (!p.taken_at) return false;
        const yr = p.taken_at.slice(0, 4);
        return yearSet.has(yr);
      });
    } else if (personFilter !== "all" && personFilter !== "years") {
      filtered = personPhotos.filter((p) => p.taken_at && p.taken_at.startsWith(personFilter));
    }

    // Chronological grouping by Month & Year
    const groupsMap = new Map<string, PhotoItem[]>();
    for (const p of filtered) {
      let groupKey = "Earlier Moments";
      if (p.taken_at) {
        try {
          const d = new Date(p.taken_at);
          if (!isNaN(d.getTime())) {
            groupKey = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
          }
        } catch {
          groupKey = "Earlier Moments";
        }
      }
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, []);
      }
      groupsMap.get(groupKey)!.push(p);
    }

    return {
      availableYears: years,
      favCount: favorites,
      timelineGroups: Array.from(groupsMap.entries()),
    };
  }, [selectedPerson, personPhotos, personFilter, selectedYears]);

  // Is a multi-year or custom range active?
  const isMultiYearActive = personFilter === "years" && selectedYears.length > 1;

  // Format a friendly range summary for the pill button (e.g. "2012–2020" or "3 Yrs")
  const rangeSummary = useMemo(() => {
    if (!isMultiYearActive) return null;
    const numYears = selectedYears.map(Number).sort((a, b) => a - b);
    const minYr = numYears[0];
    const maxYr = numYears[numYears.length - 1];
    const isContiguous = numYears.length === maxYr - minYr + 1;
    if (isContiguous) {
      return `${minYr}–${maxYr}`;
    }
    return `${selectedYears.length} Yrs`;
  }, [isMultiYearActive, selectedYears]);

  // Close Range Popover on outside click
  useEffect(() => {
    if (!isRangePopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#range-popover-container")) {
        setIsRangePopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isRangePopoverOpen]);

  // Check whether the horizontal ribbon has overflow left/right for chevrons & edge mask
  const checkRibbonScroll = useCallback(() => {
    if (!ribbonRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = ribbonRef.current;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkRibbonScroll();
    const el = ribbonRef.current;
    if (!el) return;
    const handleResize = () => checkRibbonScroll();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [checkRibbonScroll, availableYears, selectedPerson]);

  const scrollRibbon = (offset: number) => {
    if (!ribbonRef.current) return;
    ribbonRef.current.scrollBy({ left: offset, behavior: "smooth" });
  };

  // Year click handler supporting single-click, Shift-click (range), and Ctrl/Cmd-click (multi-select)
  const handleYearClick = (year: string, e: React.MouseEvent) => {
    setIsRangePopoverOpen(false);

    if (e.shiftKey && lastClickedYear && availableYears.includes(lastClickedYear)) {
      // Shift-click: select contiguous range between lastClickedYear and year
      const idx1 = availableYears.indexOf(lastClickedYear);
      const idx2 = availableYears.indexOf(year);
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      const range = availableYears.slice(start, end + 1);
      setSelectedYears(range);
      setPersonFilter("years");
    } else if (e.metaKey || e.ctrlKey) {
      // Ctrl/Cmd-click: toggle this year in/out of selection
      if (personFilter !== "years") {
        setPersonFilter("years");
        setSelectedYears([year]);
      } else {
        if (selectedYears.includes(year)) {
          const next = selectedYears.filter((y) => y !== year);
          if (next.length === 0) {
            setPersonFilter("all");
            setSelectedYears([]);
          } else {
            setSelectedYears(next);
          }
        } else {
          setSelectedYears([...selectedYears, year]);
        }
      }
      setLastClickedYear(year);
    } else {
      // Single click:
      if (personFilter === "years" && selectedYears.length === 1 && selectedYears[0] === year) {
        setPersonFilter("all");
        setSelectedYears([]);
        setLastClickedYear(null);
      } else {
        setPersonFilter("years");
        setSelectedYears([year]);
        setLastClickedYear(year);
      }
    }
  };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "400px" }}>
        <Loader2 size={32} className="spinning" style={{ color: "var(--accent-primary)" }} />
      </div>
    );
  }

  return (
    // The overview (redesign R5) lays itself out like Photos and Vault; the person page keeps its padding.
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: selectedPerson ? "auto" : "hidden",
        padding: selectedPerson ? "24px 32px" : 0,
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      {/* View: Individual Person Photos Drill-Down */}
      {selectedPerson ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Unified Compact Glassmorphic Header Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              padding: "10px 20px",
              minHeight: "56px",
              backgroundColor: "var(--glass-surface)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              position: "sticky",
              top: 0,
              zIndex: 20,
              flexShrink: 0,
            }}
          >
            {/* Left Column: Back Button */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", minWidth: "100px" }}>
              <button
                onClick={() => {
                  setSelectedPerson(null);
                  setPersonPhotos([]);
                  setPersonFilter("all");
                  setSelectedYears([]);
                  setLastClickedYear(null);
                  setIsRangePopoverOpen(false);
                  setIsRelationshipPopoverOpen(false);
                }}
                className="clickable"
                title="Back to People"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-pill-border)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                <ArrowLeft size={14} />
                <span>People</span>
              </button>
            </div>

            {/* Center Column: UNIFIED IDENTITY GROUP (Avatar + Name + VIP Star + Inline Count Badge) */}
            <div style={{ flex: "0 1 auto", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", minWidth: 0 }}>
              {/* Compact 38px Halo Avatar */}
              <div
                style={{
                  position: "relative",
                  width: "38px",
                  height: "38px",
                  borderRadius: "var(--radius-full)",
                  overflow: "hidden",
                  border: "1px solid var(--glass-border-highlight)",
                  backgroundColor: "var(--bg-surface)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {selectedPerson.cover_face_id ? (
                  <img
                    src={getApiUrl(`/api/people/faces/${selectedPerson.cover_face_id}/crop`)}
                    alt={selectedPerson.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Users size={18} style={{ color: "var(--accent-primary)" }} />
                )}
              </div>

              {/* Name & Star */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {renameDraft !== null ? (
                  <input
                    className="people-rename-input"
                    aria-label="Name"
                    value={renameDraft}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenameDraft(null);
                      }
                    }}
                  />
                ) : (
                  <h2 style={{ margin: 0 }}>
                    <button
                      type="button"
                      className="people-rename-btn"
                      title="Click to rename"
                      aria-label={`Rename ${selectedPerson.name}`}
                      onClick={() => setRenameDraft(selectedPerson.name)}
                    >
                      {selectedPerson.name}
                    </button>
                  </h2>
                )}

                {/* Interactive VIP Star Toggle */}
                <button
                  onClick={() => handleUpdatePerson(selectedPerson.id, { is_close_one: !selectedPerson.is_close_one })}
                  title={selectedPerson.is_close_one ? "Favorited (Close One)" : "Mark as Favorite"}
                  className="clickable"
                  style={{
                    background: selectedPerson.is_close_one ? "rgba(245, 158, 11, 0.18)" : "var(--glass-pill-bg)",
                    border: selectedPerson.is_close_one ? "1px solid rgba(245, 158, 11, 0.4)" : "1px solid var(--glass-pill-border)",
                    borderRadius: "var(--radius-full)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "5px",
                    color: selectedPerson.is_close_one ? "var(--accent-warning)" : "var(--text-muted)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Star size={14} fill={selectedPerson.is_close_one ? "var(--accent-warning)" : "none"} />
                </button>
              </div>
            </div>

            {/* Right Column: Relationship Popover Pill + Monochromatic Slideshow Button */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", minWidth: "120px" }}>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setIsRelationshipPopoverOpen((prev) => !prev)}
                  className="clickable"
                  title="Click to change relationship"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-pill-bg)",
                    border: "1px solid var(--glass-pill-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <Tag size={13} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                  <span>{selectedPerson.relationship_type || "Friends"}</span>
                  <ChevronDown size={12} style={{ opacity: 0.7, flexShrink: 0 }} />
                </button>

                {/* Popover Dropdown Menu */}
                {isRelationshipPopoverOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      backgroundColor: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-highlight)",
                      borderRadius: "var(--radius-md)",
                      padding: "6px",
                      boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
                      zIndex: 30,
                      minWidth: "180px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    {RELATIONSHIP_OPTIONS.map((rel) => {
                      const isSelected = (selectedPerson.relationship_type || "Friends") === rel;
                      return (
                        <button
                          key={rel}
                          disabled={updatingPerson}
                          onClick={() => {
                            handleUpdatePerson(selectedPerson.id, { relationship_type: rel });
                            setIsRelationshipPopoverOpen(false);
                          }}
                          className="clickable"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "7px 12px",
                            borderRadius: "var(--radius-sm)",
                            backgroundColor: isSelected ? "var(--glass-pill-active)" : "transparent",
                            color: isSelected ? "var(--accent-primary)" : "var(--text-primary)",
                            fontSize: "12px",
                            fontWeight: isSelected ? 600 : 500,
                            border: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            width: "100%",
                          }}
                        >
                          <span>{rel}</span>
                          {isSelected && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {personPhotos.length > 0 && (
                <button
                  onClick={() => setIsSlideshowOpen(true)}
                  className="clickable"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 16px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: "var(--glass-action-bg)",
                    border: "1px solid var(--glass-action-border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                  title="Play Slideshow"
                >
                  <Play size={13} fill="currentColor" style={{ flexShrink: 0 }} />
                  <span>Slideshow</span>
                </button>
              )}

              {/* Delete Person Identity Button */}
              <button
                onClick={() => handleDeletePerson(selectedPerson.id)}
                className="clickable"
                title="Delete person identity (photos remain safely in your library)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "34px",
                  height: "34px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-action-bg)",
                  border: "1px solid var(--glass-action-border)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--accent-danger, #ef4444)";
                  e.currentTarget.style.borderColor = "var(--accent-danger, #ef4444)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--glass-action-border)";
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Quick Filter Strip: Pinned Actions (All, Favorites, Range Popover) + Scrollable Years Ribbon */}
          {personPhotos.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", position: "relative", zIndex: 15 }}>
              {/* Left Pinned Action Group (never clipped, overflow visible for popover) */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, position: "relative" }}>
                {/* All Filter Pill */}
                <button
                  onClick={() => {
                    setPersonFilter("all");
                    setSelectedYears([]);
                    setLastClickedYear(null);
                    setIsRangePopoverOpen(false);
                  }}
                  className="clickable"
                  style={{
                    padding: "5px 14px",
                    borderRadius: "var(--radius-full)",
                    backgroundColor: personFilter === "all" ? "var(--glass-pill-active)" : "var(--glass-pill-bg)",
                    color: personFilter === "all" ? "var(--text-primary)" : "var(--text-secondary)",
                    border: personFilter === "all" ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
                    fontSize: "12px",
                    fontWeight: personFilter === "all" ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  All ({personPhotos.length})
                </button>

                {/* Favorites Filter Pill */}
                {favCount > 0 && (
                  <button
                    onClick={() => {
                      setPersonFilter("favorites");
                      setSelectedYears([]);
                      setLastClickedYear(null);
                      setIsRangePopoverOpen(false);
                    }}
                    className="clickable"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "5px 14px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: personFilter === "favorites" ? "rgba(239, 68, 68, 0.15)" : "var(--glass-pill-bg)",
                      color: personFilter === "favorites" ? "#ef4444" : "var(--text-secondary)",
                      border: personFilter === "favorites" ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--glass-pill-border)",
                      fontSize: "12px",
                      fontWeight: personFilter === "favorites" ? 600 : 500,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Heart size={12} fill={personFilter === "favorites" ? "#ef4444" : "none"} />
                    <span>Favorites ({favCount})</span>
                  </button>
                )}

                {/* Range & Multi-Year Selector Popover Button (in unclipped container) */}
                {availableYears.length > 1 && (
                  <div id="range-popover-container" style={{ position: "relative", flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        if (!isRangePopoverOpen) {
                          if (availableYears.length > 0) {
                            if (!customRangeFrom) setCustomRangeFrom(availableYears[availableYears.length - 1]);
                            if (!customRangeTo) setCustomRangeTo(availableYears[0]);
                          }
                        }
                        setIsRangePopoverOpen((prev) => !prev);
                      }}
                      className="clickable"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "5px 13px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: isMultiYearActive ? "var(--glass-pill-active)" : "var(--glass-pill-bg)",
                        color: isMultiYearActive ? "var(--accent-primary)" : "var(--text-secondary)",
                        border: isMultiYearActive ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
                        fontSize: "12px",
                        fontWeight: isMultiYearActive ? 600 : 500,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                      title={isMultiYearActive ? `Selected: ${rangeSummary}. Click to adjust or clear.` : "Select a range or multiple years"}
                    >
                      <Calendar size={13} style={{ flexShrink: 0 }} />
                      <span>{rangeSummary || "Range"}</span>
                      {isMultiYearActive ? (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setPersonFilter("all");
                            setSelectedYears([]);
                            setLastClickedYear(null);
                            setIsRangePopoverOpen(false);
                          }}
                          title="Clear range filter"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "2px",
                            borderRadius: "50%",
                            backgroundColor: "rgba(255, 255, 255, 0.12)",
                            marginLeft: "2px",
                          }}
                        >
                          <X size={11} />
                        </span>
                      ) : (
                        <ChevronDown size={11} style={{ opacity: 0.7 }} />
                      )}
                    </button>

                    {/* Range Popover Floating Window */}
                    {isRangePopoverOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 8px)",
                          left: 0,
                          backgroundColor: "var(--bg-surface-elevated)",
                          backdropFilter: "blur(28px)",
                          WebkitBackdropFilter: "blur(28px)",
                          border: "1px solid var(--border-highlight)",
                          borderRadius: "var(--radius-lg)",
                          padding: "16px",
                          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5)",
                          zIndex: 100,
                          minWidth: "300px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "14px",
                        }}
                      >
                        {/* Popover Header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                            Filter by Year Range
                          </span>
                          <button
                            onClick={() => setIsRangePopoverOpen(false)}
                            className="clickable"
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--text-muted)",
                              cursor: "pointer",
                              padding: "2px",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>

                        {/* Quick Presets */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Quick Presets
                          </span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            <button
                              onClick={() => {
                                setSelectedYears(availableYears.slice(0, 3));
                                setPersonFilter("years");
                                setIsRangePopoverOpen(false);
                              }}
                              className="clickable"
                              style={{
                                padding: "4px 10px",
                                borderRadius: "var(--radius-full)",
                                backgroundColor: "var(--glass-pill-bg)",
                                border: "1px solid var(--glass-pill-border)",
                                color: "var(--text-primary)",
                                fontSize: "11px",
                                fontWeight: 500,
                                cursor: "pointer",
                              }}
                            >
                              Last 3 Yrs
                            </button>
                            <button
                              onClick={() => {
                                setSelectedYears(availableYears.slice(0, 5));
                                setPersonFilter("years");
                                setIsRangePopoverOpen(false);
                              }}
                              className="clickable"
                              style={{
                                padding: "4px 10px",
                                borderRadius: "var(--radius-full)",
                                backgroundColor: "var(--glass-pill-bg)",
                                border: "1px solid var(--glass-pill-border)",
                                color: "var(--text-primary)",
                                fontSize: "11px",
                                fontWeight: 500,
                                cursor: "pointer",
                              }}
                            >
                              Last 5 Yrs
                            </button>
                            {availableYears.some((y) => y.startsWith("202")) && (
                              <button
                                onClick={() => {
                                  setSelectedYears(availableYears.filter((y) => y.startsWith("202")));
                                  setPersonFilter("years");
                                  setIsRangePopoverOpen(false);
                                }}
                                className="clickable"
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: "var(--radius-full)",
                                  backgroundColor: "var(--glass-pill-bg)",
                                  border: "1px solid var(--glass-pill-border)",
                                  color: "var(--text-primary)",
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                2020s
                              </button>
                            )}
                            {availableYears.some((y) => y.startsWith("201")) && (
                              <button
                                onClick={() => {
                                  setSelectedYears(availableYears.filter((y) => y.startsWith("201")));
                                  setPersonFilter("years");
                                  setIsRangePopoverOpen(false);
                                }}
                                className="clickable"
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: "var(--radius-full)",
                                  backgroundColor: "var(--glass-pill-bg)",
                                  border: "1px solid var(--glass-pill-border)",
                                  color: "var(--text-primary)",
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                2010s
                              </button>
                            )}
                            {availableYears.some((y) => y.startsWith("200")) && (
                              <button
                                onClick={() => {
                                  setSelectedYears(availableYears.filter((y) => y.startsWith("200")));
                                  setPersonFilter("years");
                                  setIsRangePopoverOpen(false);
                                }}
                                className="clickable"
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: "var(--radius-full)",
                                  backgroundColor: "var(--glass-pill-bg)",
                                  border: "1px solid var(--glass-pill-border)",
                                  color: "var(--text-primary)",
                                  fontSize: "11px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                }}
                              >
                                2000s
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Custom From / To Span */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Custom Span
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <select
                              value={customRangeFrom || availableYears[availableYears.length - 1]}
                              onChange={(e) => setCustomRangeFrom(e.target.value)}
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: "var(--radius-sm)",
                                backgroundColor: "var(--bg-surface)",
                                border: "1px solid var(--border-subtle)",
                                color: "var(--text-primary)",
                                fontSize: "12px",
                                outline: "none",
                              }}
                            >
                              {[...availableYears].reverse().map((y) => (
                                <option key={`from-${y}`} value={y}>{y}</option>
                              ))}
                            </select>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>to</span>
                            <select
                              value={customRangeTo || availableYears[0]}
                              onChange={(e) => setCustomRangeTo(e.target.value)}
                              style={{
                                flex: 1,
                                padding: "6px 8px",
                                borderRadius: "var(--radius-sm)",
                                backgroundColor: "var(--bg-surface)",
                                border: "1px solid var(--border-subtle)",
                                color: "var(--text-primary)",
                                fontSize: "12px",
                                outline: "none",
                              }}
                            >
                              {availableYears.map((y) => (
                                <option key={`to-${y}`} value={y}>{y}</option>
                              ))}
                            </select>
                          </div>
                          <button
                            onClick={() => {
                              const fromYr = customRangeFrom || availableYears[availableYears.length - 1];
                              const toYr = customRangeTo || availableYears[0];
                              const min = Math.min(Number(fromYr), Number(toYr));
                              const max = Math.max(Number(fromYr), Number(toYr));
                              const range = availableYears.filter((y) => Number(y) >= min && Number(y) <= max);
                              if (range.length > 0) {
                                setSelectedYears(range);
                                setPersonFilter("years");
                              }
                              setIsRangePopoverOpen(false);
                            }}
                            className="clickable"
                            style={{
                              marginTop: "4px",
                              padding: "6px 12px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--accent-fill)",
                              color: "var(--on-accent)",
                              border: "none",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                              textAlign: "center",
                            }}
                          >
                            Apply Range
                          </button>
                        </div>

                        {/* Tip */}
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4, borderTop: "1px solid var(--border-subtle)", paddingTop: "8px" }}>
                          💡 <strong>Pro Tip:</strong> Hold <strong>Shift</strong> to click a range or <strong>Ctrl/Cmd</strong> to select multiple years directly on the chips below.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subtle Vertical Glass Divider */}
              {availableYears.length > 0 && (
                <div style={{ width: "1px", height: "20px", backgroundColor: "var(--glass-border-highlight)", flexShrink: 0 }} />
              )}

              {/* Scrollable Years Ribbon (with Chevrons & Edge Fade Mask) */}
              {availableYears.length > 0 && (
                <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
                  {/* Left Scroll Chevron */}
                  {canScrollLeft && (
                    <button
                      onClick={() => scrollRibbon(-240)}
                      className="clickable"
                      title="Scroll earlier years"
                      style={{
                        position: "absolute",
                        left: "2px",
                        zIndex: 10,
                        width: "28px",
                        height: "28px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--glass-surface)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid var(--glass-border-highlight)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <ChevronLeft size={15} />
                    </button>
                  )}

                  {/* Scrollable Track */}
                  <div 
                    ref={ribbonRef}
                    onScroll={checkRibbonScroll}
                    onWheel={(e) => {
                      if (e.deltaY !== 0) {
                        e.currentTarget.scrollLeft += e.deltaY;
                        checkRibbonScroll();
                      }
                    }}
                    style={{ 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "8px", 
                      overflowX: "auto", 
                      whiteSpace: "nowrap",
                      scrollbarWidth: "none",
                      padding: "4px 8px 8px 8px",
                      width: "100%",
                      maskImage: canScrollLeft && canScrollRight
                        ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                        : canScrollRight
                        ? "linear-gradient(to right, black calc(100% - 32px), transparent)"
                        : canScrollLeft
                        ? "linear-gradient(to right, transparent, black 32px)"
                        : "none",
                      WebkitMaskImage: canScrollLeft && canScrollRight
                        ? "linear-gradient(to right, transparent, black 32px, black calc(100% - 32px), transparent)"
                        : canScrollRight
                        ? "linear-gradient(to right, black calc(100% - 32px), transparent)"
                        : canScrollLeft
                        ? "linear-gradient(to right, transparent, black 32px)"
                        : "none",
                    }}
                  >
                    {availableYears.map((year) => {
                      const isSelected = personFilter === "years" && selectedYears.includes(year);
                      return (
                        <button
                          key={year}
                          onClick={(e) => handleYearClick(year, e)}
                          className="clickable"
                          title={`Click to filter ${year} • Shift-click for range • Ctrl-click for multi-select`}
                          style={{
                            padding: "5px 13px",
                            borderRadius: "var(--radius-full)",
                            backgroundColor: isSelected ? "var(--glass-pill-active)" : "var(--glass-pill-bg)",
                            color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                            border: isSelected ? "1px solid var(--glass-border-highlight)" : "1px solid var(--glass-pill-border)",
                            fontSize: "12px",
                            fontWeight: isSelected ? 600 : 500,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            boxShadow: isSelected ? "0 0 10px rgba(255, 255, 255, 0.08)" : "none",
                          }}
                        >
                          {year}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right Scroll Chevron */}
                  {canScrollRight && (
                    <button
                      onClick={() => scrollRibbon(240)}
                      className="clickable"
                      title="Scroll later years"
                      style={{
                        position: "absolute",
                        right: "2px",
                        zIndex: 10,
                        width: "28px",
                        height: "28px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--glass-surface)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                        border: "1px solid var(--glass-border-highlight)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Timeline-Grouped Photos Grid */}
          {loadingPhotos ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <Loader2 size={32} className="spinning" style={{ color: "var(--accent-primary)" }} />
            </div>
          ) : personPhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
              <ImageIcon size={40} style={{ opacity: 0.3, marginBottom: "12px" }} />
              <p style={{ fontSize: "14px", fontWeight: 600 }}>No Photos Associated</p>
            </div>
          ) : timelineGroups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
              <p style={{ fontSize: "14px" }}>No photos match the selected filter.</p>
              <button
                onClick={() => {
                  setPersonFilter("all");
                  setSelectedYears([]);
                  setLastClickedYear(null);
                  setIsRangePopoverOpen(false);
                }}
                className="clickable"
                style={{
                  marginTop: "8px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--accent-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset Filter
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {timelineGroups.map(([groupTitle, photosInGroup]) => (
                <div key={groupTitle} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Timeline Cluster Header */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", paddingBottom: "2px", borderBottom: "1px solid var(--border-subtle)" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                      {groupTitle}
                    </h3>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>
                      {photosInGroup.length} {photosInGroup.length === 1 ? "photo" : "photos"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    {photosInGroup.map((photo) => {
                      const globalIdx = personPhotos.findIndex((p) => p.id === photo.id);
                      return (
                        <div
                          key={photo.id}
                          className="clickable"
                          onClick={() => onPhotoClick?.(globalIdx >= 0 ? globalIdx : 0, personPhotos)}
                          style={{
                            aspectRatio: "1",
                            borderRadius: "var(--radius-lg)",
                            overflow: "hidden",
                            position: "relative",
                            backgroundColor: "var(--bg-surface)",
                            border: "1px solid var(--border-subtle)",
                            cursor: "pointer",
                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = "translateY(-3px)";
                            e.currentTarget.style.borderColor = "var(--border-highlight)";
                            e.currentTarget.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.4)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.borderColor = "var(--border-subtle)";
                            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.2)";
                          }}
                        >
                          <img
                            src={getApiUrl(`/api/photos/${photo.id}/thumbnail`)}
                            alt={photo.filename}
                            loading="lazy"
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              if (img.naturalHeight > img.naturalWidth) {
                                img.style.objectPosition = "center 18%";
                              }
                            }}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              objectPosition: (photo.height && photo.width && photo.height > photo.width) ? "center 18%" : "center center",
                            }}
                          />

                          {/* Video Play Indicator Badge */}
                          {(photo.mime_type?.startsWith("video/") || photo.filename.toLowerCase().endsWith(".mp4") || photo.filename.toLowerCase().endsWith(".mov")) && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: "8px",
                                left: "8px",
                                zIndex: 3,
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "2px 7px",
                                borderRadius: "var(--radius-full)",
                                background: "rgba(10, 12, 18, 0.75)",
                                backdropFilter: "blur(10px)",
                                WebkitBackdropFilter: "blur(10px)",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                                color: "#ffffff",
                                fontSize: "10px",
                                fontWeight: 700,
                                letterSpacing: "0.2px",
                                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.6)",
                                pointerEvents: "none",
                              }}
                            >
                              <Play size={10} fill="#ffffff" color="#ffffff" />
                              <span>VIDEO</span>
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onToggleFavorite) {
                                onToggleFavorite(photo.id);
                                setPersonPhotos((prev) =>
                                  prev.map((p) => (p.id === photo.id ? { ...p, is_favorite: !p.is_favorite } : p))
                                );
                              }
                            }}
                            className="clickable"
                            title={photo.is_favorite ? "Remove from Favorites" : "Add to Favorites"}
                            style={{
                              position: "absolute",
                              top: "8px",
                              right: "8px",
                              backgroundColor: "rgba(0,0,0,0.6)",
                              backdropFilter: "blur(4px)",
                              WebkitBackdropFilter: "blur(4px)",
                              borderRadius: "50%",
                              padding: "6px",
                              display: photo.is_favorite ? "flex" : "none",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "none",
                              cursor: "pointer",
                              transition: "transform 0.15s ease",
                            }}
                          >
                            <Heart size={14} fill={photo.is_favorite ? "#ef4444" : "none"} color={photo.is_favorite ? "#ef4444" : "#ffffff"} />
                          </button>

                          {/* Unlink / Remove photo from person */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlinkPhoto(selectedPerson.id, photo.id);
                            }}
                            className="clickable"
                            title="Not this person (Remove photo from profile)"
                            style={{
                              position: "absolute",
                              top: "8px",
                              left: "8px",
                              backgroundColor: "rgba(10, 12, 18, 0.75)",
                              backdropFilter: "blur(6px)",
                              WebkitBackdropFilter: "blur(6px)",
                              borderRadius: "var(--radius-full)",
                              padding: "4px 8px",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              border: "1px solid rgba(255, 255, 255, 0.15)",
                              color: "var(--text-secondary)",
                              cursor: "pointer",
                              fontSize: "10px",
                              fontWeight: 600,
                              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "var(--accent-danger, #ef4444)";
                              e.currentTarget.style.borderColor = "var(--accent-danger, #ef4444)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--text-secondary)";
                              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
                            }}
                          >
                            <UserMinus size={11} />
                            <span>Remove</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cinematic Slideshow Modal */}
          <AlbumSlideshowModal
            isOpen={isSlideshowOpen}
            albumName={`${selectedPerson.name}'s Photos`}
            photos={personPhotos}
            onClose={() => setIsSlideshowOpen(false)}
          />
        </div>
      ) : (
        /* Main view (redesign R5): close ones, "Same person?", everyone, "Who is this?" */
        <PeopleOverview
          people={sortedPeople}
          clusters={unlabeledClusters}
          scanStatus={scanStatus}
          isLoading={isLoading}
          isResetting={isResetting}
          onOpenPerson={handleSelectPerson}
          onInspectFace={handleInspectFace}
          onRefresh={async () => {
            await Promise.all([fetchPeople(), fetchClusters()]);
          }}
          onScan={handleTriggerScan}
          onReset={handleResetFaces}
        />
      )}

      {/* Interactive Face Inspection Modal (Resolves overlapping, kissing, or ambiguous faces) */}
      {inspectingFaceId !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            backgroundColor: "rgba(0, 0, 0, 0.78)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => {
            setInspectingFaceId(null);
            setInspectingFaceData(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "850px",
              width: "100%",
              maxHeight: "90vh",
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-highlight)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "0 24px 64px rgba(0, 0, 0, 0.6)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Eye size={16} style={{ color: "var(--accent-primary)" }} />
                <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                  Face Context Preview
                </span>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  — Glowing frame highlights the exact person in this photo
                </span>
              </div>
              <button
                onClick={() => {
                  setInspectingFaceId(null);
                  setInspectingFaceData(null);
                }}
                className="clickable"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body: Image with Bounding Box Overlay */}
            <div
              style={{
                flex: 1,
                minHeight: "350px",
                maxHeight: "70vh",
                overflow: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#05070a",
                position: "relative",
                padding: "16px",
              }}
            >
              {loadingInspectFace ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", color: "var(--text-muted)" }}>
                  <Loader2 size={24} className="spinning" />
                  <span style={{ fontSize: "12px" }}>Loading photo context...</span>
                </div>
              ) : inspectingFaceData ? (
                <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                  <img
                    src={getApiUrl(`/api/photos/${inspectingFaceData.photo_id}/preview`)}
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (!target.src.includes("/thumbnail")) {
                        target.src = getApiUrl(`/api/photos/${inspectingFaceData.photo_id}/thumbnail`);
                      }
                    }}
                    alt={inspectingFaceData.filename}
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: "65vh",
                      objectFit: "contain",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                  {/* Glowing Box on Face */}
                  <div
                    style={{
                      position: "absolute",
                      top: `${inspectingFaceData.box_y * 100}%`,
                      left: `${inspectingFaceData.box_x * 100}%`,
                      width: `${inspectingFaceData.box_w * 100}%`,
                      height: `${inspectingFaceData.box_h * 100}%`,
                      border: "2px solid #10b981",
                      borderRadius: "6px",
                      boxShadow: "0 0 16px rgba(16, 185, 129, 0.7), inset 0 0 10px rgba(16, 185, 129, 0.3)",
                      pointerEvents: "none",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 4px)",
                        left: 0,
                        backgroundColor: "#10b981",
                        color: "#ffffff",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontSize: "10px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                      }}
                    >
                      Target Person
                    </div>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Could not load photo preview</span>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--bg-surface-elevated)",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {inspectingFaceData?.filename ? inspectingFaceData.filename : ""}
              </span>
              <button
                onClick={() => {
                  setInspectingFaceId(null);
                  setInspectingFaceData(null);
                }}
                className="clickable"
                style={{
                  padding: "6px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--accent-fill)",
                  border: "none",
                  color: "var(--on-accent)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
