import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  Users, 
  Sparkles,
  Check,
  Star,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  Heart,
  Loader2,
  Tag,
  RotateCcw,
  Search,
  X,
  Play,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  XCircle,
  Trash2,
  UserMinus,
  Eye,
} from "lucide-react";
import { PersonItem, UnlabeledClusterItem, FaceScanStatus, PhotoItem } from "../types";
import { useAppStore } from "../store/useAppStore";
import { AlbumSlideshowModal } from "./AlbumSlideshowModal";
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

// Relationships that represent immediate family or spouse (VIP / Close One by default)
const CLOSE_RELATIONSHIPS = new Set([
  "Family",
  "Spouse",
  "Child",
  "Parent",
  "Sibling",
  "Extended Family",
  // Backwards-compatible aliases
  "Wife", "Husband", "Partner", "Son", "Daughter", "Mother", "Father", "Brother", "Sister",
]);

export interface PeopleViewProps {
  onPhotoClick?: (idx: number, photos: PhotoItem[]) => void;
  onToggleFavorite?: (photoId: number) => void;
}

interface ClusterNameAutocompleteProps {
  value: string;
  people: PersonItem[];
  onChange: (name: string) => void;
  onSelectPerson: (person: PersonItem) => void;
  onSubmit: () => void;
  onOpenChange?: (open: boolean) => void;
}

const ClusterNameAutocomplete: React.FC<ClusterNameAutocompleteProps> = ({
  value,
  people,
  onChange,
  onSelectPerson,
  onSubmit,
  onOpenChange,
}) => {
  const [isOpen, setIsOpenState] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setIsOpen = useCallback((open: boolean) => {
    setIsOpenState(open);
    onOpenChange?.(open);
  }, [onOpenChange]);

  // Viewport collision detection: flip popover upwards if near bottom of screen
  useEffect(() => {
    if (isOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 250 && rect.top > 250) {
        setPlacement("top");
      } else {
        setPlacement("bottom");
      }
    }
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, setIsOpen]);

  // Compute matched suggestions
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) {
      return [...people]
        .sort((a, b) => (b.is_close_one ? 1 : 0) - (a.is_close_one ? 1 : 0) || b.confirmed_count - a.confirmed_count)
        .slice(0, 8);
    }
    return people
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aPrefix = a.name.toLowerCase().startsWith(q) ? 1 : 0;
        const bPrefix = b.name.toLowerCase().startsWith(q) ? 1 : 0;
        if (aPrefix !== bPrefix) return bPrefix - aPrefix;
        return (b.is_close_one ? 1 : 0) - (a.is_close_one ? 1 : 0) || b.confirmed_count - a.confirmed_count;
      })
      .slice(0, 8);
  }, [people, value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === "Enter") {
        onSubmit();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        onSelectPerson(filtered[highlightedIndex]);
        setIsOpen(false);
      } else {
        setIsOpen(false);
        onSubmit();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", flex: 1, zIndex: isOpen ? 60 : 1 }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Enter person name (e.g. Maya, David)..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          if (people.length > 0) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          padding: "9px 32px 9px 12px",
          borderRadius: "var(--radius-sm)",
          backgroundColor: "var(--bg-sidebar)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-primary)",
          fontSize: "12px",
          outline: "none",
          transition: "border-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--border-highlight)";
        }}
        onMouseLeave={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.borderColor = "var(--border-subtle)";
          }
        }}
      />

      {people.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen) inputRef.current?.focus();
          }}
          title={isOpen ? "Close suggestions" : "Show existing people"}
          style={{
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            padding: "4px",
            color: "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChevronDown
            size={14}
            style={{
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.15s ease",
              color: isOpen ? "var(--accent-primary)" : "var(--text-muted)",
            }}
          />
        </button>
      )}

      {/* Dual-Theme Frosted Liquid Glass Dropdown Popover */}
      {isOpen && filtered.length > 0 && (
        <div
          className="glass-panel"
          style={{
            position: "absolute",
            top: placement === "bottom" ? "calc(100% + 6px)" : "auto",
            bottom: placement === "top" ? "calc(100% + 6px)" : "auto",
            left: 0,
            right: 0,
            zIndex: 9999,
            backgroundColor: "var(--glass-surface)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-md)",
            boxShadow:
              placement === "top"
                ? "0 -14px 34px rgba(0, 0, 0, 0.28), 0 -2px 8px rgba(0, 0, 0, 0.08)"
                : "0 14px 34px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.08)",
            maxHeight: "240px",
            overflowY: "auto",
            padding: "5px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <div
            style={{
              padding: "4px 8px 6px",
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border-subtle)",
              marginBottom: "3px",
            }}
          >
            <span>Existing People</span>
            <span>{filtered.length} found</span>
          </div>

          {filtered.map((person, idx) => {
            const isHighlighted = idx === highlightedIndex;
            return (
              <div
                key={person.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectPerson(person);
                  setIsOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  backgroundColor: isHighlighted ? "var(--glass-pill-bg)" : "transparent",
                  transition: "background-color 0.12s ease",
                  gap: "10px",
                }}
              >
                {/* Avatar + Name */}
                <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      overflow: "hidden",
                      backgroundColor: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-subtle)",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--accent-primary)",
                    }}
                  >
                    {person.cover_face_id ? (
                      <img
                        src={getApiUrl(`/api/people/faces/${person.cover_face_id}/crop`)}
                        alt={person.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      person.name.charAt(0).toUpperCase()
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {person.name}
                    </span>
                    {person.is_close_one && (
                      <Star
                        size={12}
                        fill="var(--accent-warning)"
                        color="var(--accent-warning)"
                        style={{ flexShrink: 0 }}
                      />
                    )}
                  </div>
                </div>

                {/* Badges: Relationship Pill + Photo Count */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  {person.relationship_type && (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        color: "var(--accent-primary)",
                        backgroundColor: "var(--accent-glow)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {person.relationship_type}
                    </span>
                  )}
                  {person.confirmed_count > 0 && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {person.confirmed_count} {person.confirmed_count === 1 ? "photo" : "photos"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
  const { searchQuery } = useAppStore();

  // Tagging form state per cluster
  const [tagNames, setTagNames] = useState<{ [clusterId: string]: string }>({});
  const [tagRelationships, setTagRelationships] = useState<{ [clusterId: string]: string }>({});
  const [tagCloseOnes, setTagCloseOnes] = useState<{ [clusterId: string]: boolean }>({});
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [submittingCluster, setSubmittingCluster] = useState<string | null>(null);
  const [dismissingCluster, setDismissingCluster] = useState<string | null>(null);
  const [editingNames, setEditingNames] = useState<{ [personId: number]: string }>({});
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [showAllPeopleModal, setShowAllPeopleModal] = useState<boolean>(false);
  const [modalSearch, setModalSearch] = useState<string>("");

  // Selected person detail view (viewing photos of a person)
  const [selectedPerson, setSelectedPerson] = useState<PersonItem | null>(null);
  const [personPhotos, setPersonPhotos] = useState<PhotoItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(false);
  const [updatingPerson, setUpdatingPerson] = useState<boolean>(false);
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

  // Handle typing name or selecting from autocomplete (auto-fills relationship & VIP status)
  const handleNameChange = (clusterId: string, name: string) => {
    setTagNames((prev) => ({ ...prev, [clusterId]: name }));
    // Auto-fill existing person details if name matches
    const matched = people.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (matched) {
      if (matched.relationship_type) {
        setTagRelationships((prev) => ({ ...prev, [clusterId]: matched.relationship_type || "Friends" }));
      }
      setTagCloseOnes((prev) => ({ ...prev, [clusterId]: matched.is_close_one }));
    }
  };

  // Handle relationship change on a cluster card
  const handleClusterRelChange = (clusterId: string, value: string) => {
    setTagRelationships((prev) => ({ ...prev, [clusterId]: value }));
    // Auto-check Close One (VIP) if it's an immediate family or partner relation
    if (CLOSE_RELATIONSHIPS.has(value)) {
      setTagCloseOnes((prev) => ({ ...prev, [clusterId]: true }));
    }
  };

  // Dismiss a cluster suggestion (preserves photos safely)
  const handleDismissCluster = async (clusterId: string) => {
    setDismissingCluster(clusterId);
    try {
      const res = await apiFetch(`/api/people/clusters/${clusterId}/dismiss`, {
        method: "POST",
      });
      if (res.ok) {
        setUnlabeledClusters((prev) => prev.filter((c) => c.cluster_id !== clusterId));
        setActiveClusterId(null);
      }
    } catch (err) {
      console.error("Failed to dismiss cluster:", err);
    } finally {
      setDismissingCluster(null);
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

  // 1-Click Tag Cluster ("Name Once, Tag 1,000 Photos")
  const handleTagCluster = async (cluster: UnlabeledClusterItem) => {
    const name = (tagNames[cluster.cluster_id] || "").trim();
    if (!name) return;

    const finalRel = tagRelationships[cluster.cluster_id] || "Friends";

    setSubmittingCluster(cluster.cluster_id);
    try {
      const res = await apiFetch("/api/people/tag-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster_id: cluster.cluster_id,
          name,
          relationship_type: finalRel,
          is_close_one: !!tagCloseOnes[cluster.cluster_id] || CLOSE_RELATIONSHIPS.has(finalRel),
        }),
      });

      if (res.ok) {
        // Optimistic update
        setUnlabeledClusters((prev) => prev.filter((c) => c.cluster_id !== cluster.cluster_id));
        setActiveClusterId(null);
        await fetchPeople();
      }
    } catch (err) {
      console.error("Failed to tag cluster:", err);
    } finally {
      setSubmittingCluster(null);
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

  // Handle card inline name typing
  const handleCardNameChange = (personId: number, val: string) => {
    setEditingNames((prev) => ({ ...prev, [personId]: val }));
  };

  // Handle card inline name commit on Enter or blur
  const handleCardNameBlurOrEnter = async (person: PersonItem) => {
    const rawVal = editingNames[person.id];
    if (rawVal === undefined) return;
    const trimmed = rawVal.trim();
    if (!trimmed || trimmed === person.name) {
      setEditingNames((prev) => {
        const next = { ...prev };
        delete next[person.id];
        return next;
      });
      return;
    }
    await handleUpdatePerson(person.id, { name: trimmed });
    setEditingNames((prev) => {
      const next = { ...prev };
      delete next[person.id];
      return next;
    });
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

  const filteredPeople = sortedPeople.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.relationship_type && p.relationship_type.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const modalFilteredPeople = sortedPeople.filter((p) =>
    p.name.toLowerCase().includes(modalSearch.toLowerCase()) ||
    (p.relationship_type && p.relationship_type.toLowerCase().includes(modalSearch.toLowerCase()))
  );

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
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", display: "flex", flexDirection: "column", gap: "24px" }}>
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
                <h2
                  style={{
                    fontSize: "22px",
                    fontWeight: 800,
                    fontFamily: "var(--font-display, var(--font-sans))",
                    letterSpacing: "-0.03em",
                    color: "var(--text-primary)",
                    margin: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedPerson.name}
                </h2>

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
        /* Main View: People Gallery & Unlabeled Clusters */
        <>
          {/* Header & Actions (macOS Liquid Glass Floating Toolbar) */}
          <div 
            className="liquid-glass-toolbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              minHeight: "56px",
              backgroundColor: "var(--glass-surface)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--glass-shadow)",
              position: "sticky",
              top: 0,
              zIndex: 20,
            }}
          >
            {/* Left Column (flex: 1): Context Badge */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "10px" }}>
              <span 
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "11px",
                  fontWeight: 600,
                  backgroundColor: "rgba(139, 92, 246, 0.12)",
                  color: "var(--accent-vault, #8b5cf6)",
                  border: "1px solid rgba(139, 92, 246, 0.25)",
                }}
              >
                <Users size={13} style={{ color: "var(--accent-vault, #8b5cf6)" }} />
                Face Intelligence
              </span>
            </div>

            {/* Center Column (flex: 0 1 auto): 22px display-font title + Baseline Capsule */}
            <div 
              style={{ 
                flex: "0 1 auto", 
                display: "flex", 
                alignItems: "baseline", 
                justifyContent: "center", 
                gap: "10px" 
              }}
            >
              <h1 
                style={{ 
                  fontSize: "22px", 
                  fontWeight: 800, 
                  letterSpacing: "-0.03em", 
                  margin: 0,
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-display)",
                  whiteSpace: "nowrap",
                }}
              >
                People & Family
              </h1>
              <span 
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  borderRadius: "var(--radius-full)",
                  fontSize: "11px",
                  fontWeight: 700,
                  backgroundColor: "var(--glass-badge-bg)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--glass-badge-border)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {people.length} {people.length === 1 ? "Person" : "People"}
              </span>
            </div>

            {/* Right Column (flex: 1): Action Pill Buttons */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px" }}>
              {/* Reset Faces Button */}
              <button
                onClick={handleResetFaces}
                disabled={scanStatus.is_scanning || isResetting}
                className="clickable"
                title="Reset all face identification and clusters to start over fresh"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: scanStatus.is_scanning || isResetting ? "default" : "pointer",
                  opacity: scanStatus.is_scanning || isResetting ? 0.6 : 1,
                  transition: "all 0.2s ease",
                  boxShadow: "var(--glass-shadow)",
                }}
                onMouseEnter={(e) => {
                  if (!scanStatus.is_scanning && !isResetting) {
                    e.currentTarget.style.color = "var(--accent-danger, #ef4444)";
                    e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
                    e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.borderColor = "var(--glass-border)";
                  e.currentTarget.style.backgroundColor = "var(--glass-pill-bg)";
                }}
              >
                <RotateCcw size={13} className={isResetting ? "spinning" : ""} />
                {isResetting ? "Resetting..." : "Reset Faces"}
              </button>

              {/* Scan Photos Button */}
              <button
                onClick={handleTriggerScan}
                disabled={scanStatus.is_scanning}
                className="clickable"
                title="Scan library photos for faces"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "6px 16px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: scanStatus.is_scanning ? "var(--glass-pill-bg)" : "var(--accent-fill)",
                  border: "1px solid var(--glass-border)",
                  color: scanStatus.is_scanning ? "var(--text-secondary)" : "var(--on-accent)",
                  fontSize: "12px",
                  fontWeight: 600,
                  opacity: scanStatus.is_scanning ? 0.7 : 1,
                  cursor: scanStatus.is_scanning ? "default" : "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: scanStatus.is_scanning ? "none" : "0 2px 8px color-mix(in srgb, var(--accent-ink) 35%, transparent)",
                }}
              >
                <RefreshCw size={13} className={scanStatus.is_scanning ? "spinning" : ""} />
                {scanStatus.is_scanning ? "Scanning..." : "Scan Faces"}
              </button>
            </div>
          </div>

          {/* Active Face Scanning Banner */}
          {scanStatus.is_scanning && (
            <div
              className="glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                padding: "16px 20px",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--accent-primary)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Loader2 size={16} className="spinning" style={{ color: "var(--accent-primary)" }} />
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                    Scanning Library for Faces...
                  </span>
                  {scanStatus.current_photo && (
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      ({scanStatus.current_photo})
                    </span>
                  )}
                </div>

                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent-primary)" }}>
                  {scanStatus.scanned_photos} / {scanStatus.total_photos} photos • {scanStatus.faces_found} faces detected
                </span>
              </div>

              {/* Progress bar */}
              <div
                style={{
                  width: "100%",
                  height: "6px",
                  borderRadius: "3px",
                  backgroundColor: "var(--bg-sidebar)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${scanStatus.total_photos > 0 ? (scanStatus.scanned_photos / scanStatus.total_photos) * 100 : 0}%`,
                    backgroundColor: "var(--accent-fill)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}



          {/* Section 1: Recognized People (Compact Single Horizontal Shelf) */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Users size={18} style={{ color: "var(--accent-primary)" }} />
                <h2 style={{ fontSize: "15px", fontWeight: 700 }}>
                  Recognized People ({filteredPeople.length})
                </h2>
              </div>
              {people.length > 0 && (
                <button
                  onClick={() => setShowAllPeopleModal(true)}
                  className="clickable"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent-primary)",
                    fontSize: "12px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    cursor: "pointer",
                    padding: "4px 8px",
                    borderRadius: "var(--radius-sm)",
                  }}
                  title="View and manage all recognized people"
                >
                  <span>See All ({people.length})</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>

            {filteredPeople.length === 0 ? (
              people.length === 0 ? (
                unlabeledClusters.length === 0 && !scanStatus.is_scanning ? (
                  <div
                    style={{
                      padding: "50px 20px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      textAlign: "center",
                      backgroundColor: "var(--bg-surface)",
                      borderRadius: "var(--radius-md)",
                      border: "1px dashed var(--border-subtle)",
                    }}
                  >
                    <Users size={44} style={{ opacity: 0.3, marginBottom: "10px" }} />
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                      No People Identified Yet
                    </p>
                    <p style={{ fontSize: "12px", marginTop: "4px", maxWidth: "420px", lineHeight: "1.5" }}>
                      Click "Scan Faces" above to run on-device facial detection across your media library.
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "14px 18px",
                      backgroundColor: "var(--bg-surface)",
                      borderRadius: "var(--radius-md)",
                      border: "1px dashed var(--border-subtle)",
                      color: "var(--text-muted)",
                      fontSize: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Users size={16} style={{ opacity: 0.6 }} />
                    <span>No recognized people yet. Name an unlabeled cluster below to create your first person profile!</span>
                  </div>
                )
              ) : (
                <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                  <p style={{ fontSize: "13px" }}>No recognized people match "{searchQuery}"</p>
                </div>
              )
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "18px",
                  overflowX: "auto",
                  paddingBottom: "8px",
                  paddingTop: "2px",
                  scrollbarWidth: "none",
                }}
              >
                {filteredPeople.map((person) => (
                  <div
                    key={person.id}
                    onClick={() => handleSelectPerson(person)}
                    className="clickable"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      width: "74px",
                      flexShrink: 0,
                      cursor: "pointer",
                      position: "relative",
                    }}
                    title={`${person.name} (${person.relationship_type || "Friends"}) • ${person.confirmed_count} photos`}
                  >
                    {/* Rounded Circular Avatar */}
                    <div
                      style={{
                        position: "relative",
                        width: "60px",
                        height: "60px",
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "2px solid var(--accent-primary)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        transition: "transform 0.2s ease, box-shadow 0.2s ease",
                        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.18)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "scale(1.08)";
                        e.currentTarget.style.boxShadow = "0 4px 12px color-mix(in srgb, var(--accent-ink) 35%, transparent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.18)";
                      }}
                    >
                      {person.cover_face_id ? (
                        <img
                          src={getApiUrl(`/api/people/faces/${person.cover_face_id}/crop`)}
                          alt={person.name}
                          loading="lazy"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <Users size={24} style={{ color: "var(--accent-primary)" }} />
                      )}
                    </div>

                    {/* VIP Close One Star Indicator */}
                    {person.is_close_one && (
                      <div
                        style={{
                          position: "absolute",
                          top: "40px",
                          right: "6px",
                          backgroundColor: "var(--bg-sidebar)",
                          borderRadius: "50%",
                          width: "18px",
                          height: "18px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                        }}
                        title="Close One (VIP)"
                      >
                        <Star size={11} fill="var(--accent-warning)" color="var(--accent-warning)" />
                      </div>
                    )}

                    {/* Name */}
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        width: "100%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {person.name}
                    </div>

                    {/* Relationship Subtext */}
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        width: "100%",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginTop: "1px",
                      }}
                    >
                      {person.relationship_type || "Friends"}
                    </div>
                  </div>
                ))}

                {/* "See All" Circular Tile at End of Shelf */}
                <div
                  onClick={() => setShowAllPeopleModal(true)}
                  className="clickable"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    width: "74px",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                  title="View and manage all recognized people"
                >
                  <div
                    style={{
                      width: "60px",
                      height: "60px",
                      borderRadius: "50%",
                      border: "2px dashed var(--border-highlight)",
                      backgroundColor: "var(--bg-surface-elevated)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-primary)",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--accent-primary)";
                      e.currentTarget.style.color = "var(--accent-primary)";
                      e.currentTarget.style.transform = "scale(1.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-highlight)";
                      e.currentTarget.style.color = "var(--text-primary)";
                      e.currentTarget.style.transform = "scale(1)";
                    }}
                  >
                    <ArrowRight size={20} />
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    See All
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      marginTop: "1px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {people.length} total
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Unlabeled Face Clusters ("Name Once, Tag 1,000 Photos") */}
          {unlabeledClusters.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <Sparkles size={18} style={{ color: "var(--accent-primary)" }} />
                <h2 style={{ fontSize: "16px", fontWeight: 700 }}>
                  Unlabeled Face Clusters Found ({unlabeledClusters.length})
                </h2>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  (Automatic Grouping • Name once to tag all photos)
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))",
                  gap: "18px",
                }}
              >
                {unlabeledClusters.map((cluster) => {
                  const isSubmitting = submittingCluster === cluster.cluster_id;
                  const currentName = tagNames[cluster.cluster_id] || "";
                  const currentRel = tagRelationships[cluster.cluster_id] || "Friends";
                  const isClose = !!tagCloseOnes[cluster.cluster_id];
                  const isCardActive = activeClusterId === cluster.cluster_id;

                  return (
                    <div
                      key={cluster.cluster_id}
                      className="glass-panel"
                      style={{
                        position: "relative",
                        zIndex: isCardActive ? 50 : 1,
                        borderRadius: "var(--radius-md)",
                        padding: "18px",
                        backgroundColor: "var(--bg-surface)",
                        border: "1px solid var(--border-highlight)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Who is this person?</h3>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            color: "var(--accent-primary)",
                            backgroundColor: "var(--accent-glow)",
                            padding: "3px 10px",
                            borderRadius: "var(--radius-full)",
                            fontWeight: 600,
                          }}
                        >
                          Found in {cluster.photo_count} photos ({cluster.face_count} faces)
                        </span>
                      </div>

                      {/* Fixed 4-Slot Anchor Faces Grid with Interactive Full-Photo Inspection */}
                      {(() => {
                        const rawFaces = cluster.anchor_face_ids && cluster.anchor_face_ids.length > 0
                          ? cluster.anchor_face_ids
                          : (cluster.medoid_face_id ? [cluster.medoid_face_id] : []);
                        // Always create an array of 4 slots, padding missing faces with null
                        const slots: (number | null)[] = [
                          rawFaces[0] ?? null,
                          rawFaces[1] ?? null,
                          rawFaces[2] ?? null,
                          rawFaces[3] ?? null,
                        ];

                        return (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(4, 1fr)",
                              gap: "8px",
                            }}
                          >
                            {slots.map((faceId, idx) => (
                              faceId ? (
                                <div
                                  key={faceId}
                                  onClick={() => handleInspectFace(faceId)}
                                  className="clickable"
                                  title="Click to view full photo and highlight face"
                                  style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    borderRadius: "var(--radius-sm)",
                                    overflow: "hidden",
                                    backgroundColor: "var(--bg-sidebar)",
                                    cursor: "pointer",
                                    border: "1px solid var(--border-subtle)",
                                    transition: "all 0.15s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = "var(--accent-primary)";
                                    e.currentTarget.style.transform = "scale(1.03)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = "var(--border-subtle)";
                                    e.currentTarget.style.transform = "scale(1)";
                                  }}
                                >
                                  <img
                                    src={getApiUrl(`/api/people/faces/${faceId}/crop`)}
                                    alt="Face crop"
                                    loading="lazy"
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "cover",
                                    }}
                                  />
                                  {faceId === cluster.medoid_face_id && (
                                    <div
                                      title="Primary Face Match"
                                      style={{
                                        position: "absolute",
                                        bottom: "4px",
                                        left: "4px",
                                        backgroundColor: "rgba(0, 0, 0, 0.75)",
                                        backdropFilter: "blur(4px)",
                                        padding: "2px 6px",
                                        borderRadius: "3px",
                                        fontSize: "9px",
                                        fontWeight: 600,
                                        color: "var(--accent-primary)",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "3px",
                                      }}
                                    >
                                      <Sparkles size={8} /> Primary
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div
                                  key={`empty-${idx}`}
                                  style={{
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    visibility: "hidden",
                                  }}
                                />
                              )
                            ))}
                          </div>
                        );
                      })()}

                      {/* Inputs: Name with Autocomplete, Relationship Selector, Close One Toggle */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <ClusterNameAutocomplete
                            value={currentName}
                            people={people}
                            onChange={(name) => handleNameChange(cluster.cluster_id, name)}
                            onOpenChange={(open) => setActiveClusterId(open ? cluster.cluster_id : null)}
                            onSelectPerson={(person) => {
                              handleNameChange(cluster.cluster_id, person.name);
                              if (person.relationship_type) {
                                setTagRelationships((prev) => ({ ...prev, [cluster.cluster_id]: person.relationship_type || "Friends" }));
                              }
                              setTagCloseOnes((prev) => ({ ...prev, [cluster.cluster_id]: person.is_close_one }));
                              setActiveClusterId(null);
                            }}
                            onSubmit={() => {
                              setActiveClusterId(null);
                              handleTagCluster(cluster);
                            }}
                          />

                          {/* Relationship Selector */}
                          <select
                            value={currentRel}
                            onChange={(e) => handleClusterRelChange(cluster.cluster_id, e.target.value)}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--bg-sidebar)",
                              border: "1px solid var(--border-subtle)",
                              color: "var(--text-primary)",
                              fontSize: "12px",
                              outline: "none",
                              minWidth: "135px",
                            }}
                          >
                            {RELATIONSHIP_OPTIONS.map((rel) => (
                              <option key={rel} value={rel}>{rel}</option>
                            ))}
                          </select>

                          {/* Close One Star Toggle */}
                          <button
                            title={isClose ? "Marked as Close One (VIP)" : "Mark as Close One (VIP)"}
                            onClick={() => setTagCloseOnes({ ...tagCloseOnes, [cluster.cluster_id]: !isClose })}
                            className="clickable"
                            style={{
                              padding: "0 10px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: isClose ? "rgba(245, 158, 11, 0.15)" : "var(--bg-sidebar)",
                              border: isClose ? "1px solid var(--accent-warning)" : "1px solid var(--border-subtle)",
                              color: isClose ? "var(--accent-warning)" : "var(--text-muted)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Star size={16} fill={isClose ? "var(--accent-warning)" : "none"} />
                          </button>
                        </div>

                        {/* If typed name matches an existing person, show merge badge */}
                        {(() => {
                          const matched = people.find((p) => p.name.trim().toLowerCase() === currentName.trim().toLowerCase());
                          if (matched && currentName.trim()) {
                            return (
                              <div
                                style={{
                                  fontSize: "11px",
                                  color: "var(--accent-primary)",
                                  backgroundColor: "var(--accent-glow)",
                                  padding: "4px 8px",
                                  borderRadius: "var(--radius-sm)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                              >
                                <Sparkles size={12} />
                                <span>Existing person: <strong>{matched.name}</strong> ({matched.relationship_type || "Friends"}). Tagging will merge photos into their profile.</span>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Action Buttons: Tag Cluster + Dismiss False Positive */}
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            onClick={() => handleTagCluster(cluster)}
                            disabled={!currentName.trim() || isSubmitting}
                            className="clickable"
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                              padding: "9px 16px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: currentName.trim() ? "var(--accent-fill)" : "var(--bg-surface-elevated)",
                              border: "none",
                              color: currentName.trim() ? "var(--on-accent)" : "var(--text-muted)",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: currentName.trim() && !isSubmitting ? "pointer" : "default",
                              opacity: isSubmitting ? 0.7 : 1,
                            }}
                          >
                            {isSubmitting ? (
                              <Loader2 size={14} className="spinning" />
                            ) : (
                              <Check size={14} />
                            )}
                            Tag {cluster.photo_count} Photo{cluster.photo_count === 1 ? "" : "s"} as "{currentName.trim() || "..."}"
                          </button>

                          <button
                            onClick={() => handleDismissCluster(cluster.cluster_id)}
                            disabled={dismissingCluster === cluster.cluster_id}
                            title="Dismiss this suggestion without deleting photos"
                            className="clickable"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              padding: "9px 14px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--bg-sidebar)",
                              border: "1px solid var(--border-subtle)",
                              color: "var(--text-muted)",
                              fontSize: "12px",
                              fontWeight: 500,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "var(--accent-danger, #ef4444)";
                              e.currentTarget.style.borderColor = "var(--accent-danger, #ef4444)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--text-muted)";
                              e.currentTarget.style.borderColor = "var(--border-subtle)";
                            }}
                          >
                            {dismissingCluster === cluster.cluster_id ? (
                              <Loader2 size={13} className="spinning" />
                            ) : (
                              <XCircle size={13} />
                            )}
                            Dismiss Suggestion
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* "See All" Full People Management Modal */}
      {showAllPeopleModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
          onClick={() => setShowAllPeopleModal(false)}
        >
          <div
            className="glass-panel"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-highlight)",
              width: "100%",
              maxWidth: "960px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--bg-surface-elevated)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Users size={20} style={{ color: "var(--accent-primary)" }} />
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>
                    All Recognized People ({people.length})
                  </h2>
                  <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0" }}>
                    Review, edit names, update relationships, or fix tags
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Modal Search Input */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 12px",
                    backgroundColor: "var(--bg-sidebar)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-subtle)",
                    width: "220px",
                  }}
                >
                  <Search size={14} style={{ color: "var(--text-muted)" }} />
                  <input
                    type="text"
                    placeholder="Search people..."
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    style={{
                      background: "none",
                      border: "none",
                      outline: "none",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      width: "100%",
                    }}
                  />
                  {modalSearch && (
                    <button
                      onClick={() => setModalSearch("")}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setShowAllPeopleModal(false)}
                  className="clickable"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: "6px",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Close"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content: Full Management Grid */}
            <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
              {modalFilteredPeople.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  <Users size={36} style={{ opacity: 0.3, marginBottom: "10px" }} />
                  <p style={{ fontSize: "14px" }}>No recognized people match "{modalSearch}"</p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {modalFilteredPeople.map((person) => (
                    <div
                      key={person.id}
                      className="glass-panel"
                      style={{
                        borderRadius: "var(--radius-md)",
                        padding: "14px",
                        backgroundColor: "var(--bg-surface)",
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textAlign: "center",
                        position: "relative",
                        transition: "transform 0.15s ease, border-color 0.15s ease",
                      }}
                    >
                      {/* Close One VIP Star Toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdatePerson(person.id, { is_close_one: !person.is_close_one });
                        }}
                        title={person.is_close_one ? "Close One (VIP) - Click to unstar" : "Mark as Close One (VIP)"}
                        className="clickable"
                        style={{
                          position: "absolute",
                          top: "8px",
                          right: "8px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px",
                          color: person.is_close_one ? "var(--accent-warning)" : "var(--text-muted)",
                          opacity: person.is_close_one ? 1 : 0.4,
                        }}
                      >
                        <Star size={15} fill={person.is_close_one ? "var(--accent-warning)" : "none"} />
                      </button>

                      {/* Avatar with click to browse */}
                      <div
                        onClick={() => {
                          setShowAllPeopleModal(false);
                          handleSelectPerson(person);
                        }}
                        className="clickable"
                        title="Click to view all photos of this person"
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "50%",
                          backgroundColor: "var(--bg-surface-elevated)",
                          border: "2px solid var(--accent-primary)",
                          overflow: "hidden",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginBottom: "10px",
                          cursor: "pointer",
                        }}
                      >
                        {person.cover_face_id ? (
                          <img
                            src={getApiUrl(`/api/people/faces/${person.cover_face_id}/crop`)}
                            alt={person.name}
                            loading="lazy"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <Users size={24} style={{ color: "var(--accent-primary)" }} />
                        )}
                      </div>

                      {/* In-Card Editable Name */}
                      <div style={{ width: "100%" }}>
                        <input
                          type="text"
                          value={editingNames[person.id] !== undefined ? editingNames[person.id] : person.name}
                          onChange={(e) => handleCardNameChange(person.id, e.target.value)}
                          onBlur={() => handleCardNameBlurOrEnter(person)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          title="Click to edit name (press Enter or click outside to save)"
                          placeholder="Person name..."
                          style={{
                            width: "100%",
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            backgroundColor: "transparent",
                            border: "1px solid transparent",
                            borderRadius: "var(--radius-sm)",
                            textAlign: "center",
                            padding: "2px 4px",
                            outline: "none",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "var(--border-subtle)";
                            e.currentTarget.style.backgroundColor = "var(--bg-surface-elevated)";
                          }}
                          onMouseLeave={(e) => {
                            if (document.activeElement !== e.currentTarget) {
                              e.currentTarget.style.borderColor = "transparent";
                              e.currentTarget.style.backgroundColor = "transparent";
                            }
                          }}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "var(--accent-primary)";
                            e.currentTarget.style.backgroundColor = "var(--bg-surface-elevated)";
                          }}
                        />
                      </div>

                      {/* In-Card Editable Relationship Dropdown */}
                      <div style={{ marginTop: "6px", width: "100%" }}>
                        <select
                          value={person.relationship_type || "Friends"}
                          onChange={(e) => {
                            handleUpdatePerson(person.id, { relationship_type: e.target.value });
                          }}
                          style={{
                            width: "100%",
                            padding: "4px 8px",
                            borderRadius: "var(--radius-sm)",
                            backgroundColor: "var(--bg-sidebar)",
                            border: "1px solid var(--border-subtle)",
                            color: "var(--text-primary)",
                            fontSize: "11px",
                            fontWeight: 600,
                            textAlign: "center",
                            cursor: "pointer",
                            outline: "none",
                          }}
                          title="Change relationship"
                        >
                          {RELATIONSHIP_OPTIONS.map((rel) => (
                            <option key={rel} value={rel}>{rel}</option>
                          ))}
                        </select>
                      </div>

                      {/* Photo count & browse link */}
                      <button
                        onClick={() => {
                          setShowAllPeopleModal(false);
                          handleSelectPerson(person);
                        }}
                        className="clickable"
                        style={{
                          marginTop: "8px",
                          background: "none",
                          border: "none",
                          fontSize: "11px",
                          color: "var(--accent-primary)",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: "2px 6px",
                        }}
                      >
                        Browse {person.confirmed_count} {person.confirmed_count === 1 ? "photo" : "photos"} →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: "12px 24px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "flex-end",
                backgroundColor: "var(--bg-surface-elevated)",
              }}
            >
              <button
                onClick={() => setShowAllPeopleModal(false)}
                className="clickable"
                style={{
                  padding: "6px 18px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--accent-fill)",
                  border: "none",
                  color: "var(--on-accent)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
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
