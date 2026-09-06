import React, { useState, useEffect, useCallback } from "react";
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
  UserX,
  RotateCcw,
  Search,
  X
} from "lucide-react";
import { PersonItem, UnlabeledClusterItem, FaceScanStatus, PhotoItem } from "../types";
import { useAppStore } from "../store/useAppStore";

const API_BASE = "http://127.0.0.1:8000/api";

export const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Child",
  "Parent",
  "Sibling",
  "Extended Family",
  "Friend",
  "Relative",
  "Colleague",
  "Acquaintance",
];

// Priority hierarchy for organizing and surfacing recognized people (Friends=5, Relatives=4)
export const RELATION_PRIORITY: Record<string, number> = {
  "Spouse": 10,
  "Child": 9,
  "Parent": 8,
  "Sibling": 7,
  "Extended Family": 6,
  "Friend": 5,
  "Relative": 4,
  "Colleague": 3,
  "Acquaintance": 2,
};

// Relationships that represent immediate family or spouse (VIP / Close One by default)
const CLOSE_RELATIONSHIPS = new Set([
  "Spouse",
  "Child",
  "Parent",
  "Sibling",
  "Extended Family",
  // Backwards-compatible aliases
  "Wife", "Husband", "Partner", "Son", "Daughter", "Mother", "Father", "Brother", "Sister",
]);

export const PeopleView: React.FC = () => {
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

  // Load recognized people
  const fetchPeople = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/people`);
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
      const res = await fetch(`${API_BASE}/people/clusters`);
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
      const res = await fetch(`${API_BASE}/people/scan-progress`);
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

  // Trigger manual face scan
  const handleTriggerScan = async () => {
    // Immediate visual feedback
    setScanStatus((prev) => ({
      ...prev,
      is_scanning: true,
      scanned_photos: 0,
      total_photos: prev.total_photos || 1,
    }));
    try {
      const res = await fetch(`${API_BASE}/people/scan?force=true`, { method: "POST" });
      if (res.ok) {
        const statusData: FaceScanStatus = await res.json();
        setScanStatus(statusData);
      }
    } catch (err) {
      console.error("Failed to trigger face scan:", err);
      setScanStatus((prev) => ({ ...prev, is_scanning: false }));
    }
  };

  // Handle typing name or selecting from autocomplete (auto-fills relationship & VIP status)
  const handleNameChange = (clusterId: string, name: string) => {
    setTagNames((prev) => ({ ...prev, [clusterId]: name }));
    // Auto-fill existing person details if name matches
    const matched = people.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (matched) {
      if (matched.relationship_type) {
        setTagRelationships((prev) => ({ ...prev, [clusterId]: matched.relationship_type || "Friend" }));
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

  // Dismiss a cluster as Not a Face / False Positive
  const handleDismissCluster = async (clusterId: string) => {
    setDismissingCluster(clusterId);
    try {
      const res = await fetch(`${API_BASE}/people/clusters/${clusterId}/dismiss`, {
        method: "POST",
      });
      if (res.ok) {
        setUnlabeledClusters((prev) => prev.filter((c) => c.cluster_id !== clusterId));
      }
    } catch (err) {
      console.error("Failed to dismiss cluster:", err);
    } finally {
      setDismissingCluster(null);
    }
  };

  // 1-Click Tag Cluster ("Name Once, Tag 1,000 Photos")
  const handleTagCluster = async (cluster: UnlabeledClusterItem) => {
    const name = (tagNames[cluster.cluster_id] || "").trim();
    if (!name) return;

    const finalRel = tagRelationships[cluster.cluster_id] || "Friend";

    setSubmittingCluster(cluster.cluster_id);
    try {
      const res = await fetch(`${API_BASE}/people/tag-cluster`, {
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
    try {
      const res = await fetch(`${API_BASE}/people/${person.id}/photos`);
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
      const res = await fetch(`${API_BASE}/people/${personId}`, {
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
      const res = await fetch(`${API_BASE}/people/reset`, { method: "POST" });
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

  // Sort recognized people by relationship priority (Friends=5, Relatives=4), then photo count, then name
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
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <button
                onClick={() => setSelectedPerson(null)}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                <ArrowLeft size={16} />
                Back to People
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "var(--radius-full)",
                    overflow: "hidden",
                    border: "2px solid var(--accent-primary)",
                    backgroundColor: "var(--bg-surface-elevated)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selectedPerson.cover_face_id ? (
                    <img
                      src={`${API_BASE}/people/faces/${selectedPerson.cover_face_id}/crop`}
                      alt={selectedPerson.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Users size={26} style={{ color: "var(--accent-primary)" }} />
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h1 style={{ fontSize: "20px", fontWeight: 700 }}>{selectedPerson.name}</h1>
                    {/* Interactive VIP Toggle */}
                    <button
                      onClick={() => handleUpdatePerson(selectedPerson.id, { is_close_one: !selectedPerson.is_close_one })}
                      title={selectedPerson.is_close_one ? "Close One (High Priority)" : "Mark as Close One (VIP)"}
                      className="clickable"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        padding: "2px",
                        color: selectedPerson.is_close_one ? "var(--accent-warning)" : "var(--text-muted)",
                      }}
                    >
                      <Star size={18} fill={selectedPerson.is_close_one ? "var(--accent-warning)" : "none"} />
                    </button>
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {personPhotos.length} {personPhotos.length === 1 ? "photo" : "photos"} found in your library
                  </p>
                </div>
              </div>
            </div>

            {/* Granular Relationship Customizer */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Tag size={15} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>
                Relationship:
              </span>
              <select
                value={selectedPerson.relationship_type || "Friend"}
                disabled={updatingPerson}
                onChange={(e) => handleUpdatePerson(selectedPerson.id, { relationship_type: e.target.value })}
                style={{
                  padding: "7px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border-highlight)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {RELATIONSHIP_OPTIONS.map((rel) => (
                  <option key={rel} value={rel}>{rel}</option>
                ))}
              </select>

              {/* Affinity Score */}
              <div
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: selectedPerson.is_close_one ? "rgba(16, 185, 129, 0.12)" : "var(--bg-surface-elevated)",
                  color: selectedPerson.is_close_one ? "var(--accent-success)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                Affinity: {Math.round(selectedPerson.affinity_score)}/100
              </div>
            </div>
          </div>

          {/* Photos Grid */}
          {loadingPhotos ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
              <Loader2 size={32} className="spinning" style={{ color: "var(--accent-primary)" }} />
            </div>
          ) : personPhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
              <ImageIcon size={40} style={{ opacity: 0.3, marginBottom: "12px" }} />
              <p style={{ fontSize: "14px", fontWeight: 600 }}>No Photos Associated</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "12px",
              }}
            >
              {personPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="clickable"
                  style={{
                    aspectRatio: "1",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    position: "relative",
                    backgroundColor: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <img
                    src={`http://127.0.0.1:8000/api/photos/${photo.id}/thumbnail`}
                    alt={photo.filename}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transition: "transform 0.2s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1.0)")}
                  />
                  {photo.is_favorite && (
                    <div
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        backgroundColor: "rgba(0,0,0,0.6)",
                        borderRadius: "50%",
                        padding: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Heart size={14} fill="#ef4444" color="#ef4444" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Main View: People Gallery & Unlabeled Clusters */
        <>
          {/* Header Bar: Title on Left, Action Buttons on Right */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Users size={22} style={{ color: "var(--accent-primary)" }} />
                <h1 style={{ fontSize: "20px", fontWeight: 700 }}>People & Family</h1>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>
                Group and organize photos of people in your library • 100% Private & On-Device
              </p>
            </div>

            {/* Actions: Reset Faces + Scan Library */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {/* Reset Faces Button */}
              <button
                onClick={handleResetFaces}
                disabled={scanStatus.is_scanning || isResetting}
                className="clickable"
                title="Reset all face identification and clusters to start over fresh"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 13px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-highlight)",
                  color: "var(--text-primary)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: scanStatus.is_scanning || isResetting ? "default" : "pointer",
                  opacity: scanStatus.is_scanning || isResetting ? 0.6 : 1,
                  transition: "all 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                }}
                onMouseEnter={(e) => {
                  if (!scanStatus.is_scanning && !isResetting) {
                    e.currentTarget.style.color = "var(--accent-danger, #ef4444)";
                    e.currentTarget.style.borderColor = "var(--accent-danger, #ef4444)";
                    e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-primary)";
                  e.currentTarget.style.borderColor = "var(--border-highlight)";
                  e.currentTarget.style.backgroundColor = "var(--bg-surface-elevated)";
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
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "7px 15px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: scanStatus.is_scanning ? "var(--bg-surface-elevated)" : "var(--accent-primary)",
                  border: "1px solid var(--border-highlight)",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  opacity: scanStatus.is_scanning ? 0.7 : 1,
                  cursor: scanStatus.is_scanning ? "default" : "pointer",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
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
                    backgroundColor: "var(--accent-primary)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          )}

          {/* Autocomplete Datalist for Recognized People */}
          <datalist id="existing-people-datalist">
            {people.map((p) => (
              <option key={p.id} value={p.name}>
                {p.relationship_type ? `${p.relationship_type}` : ""}
              </option>
            ))}
          </datalist>

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
                    title={`${person.name} (${person.relationship_type || "Friend"}) • ${person.confirmed_count} photos`}
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
                        e.currentTarget.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.35)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.18)";
                      }}
                    >
                      {person.cover_face_id ? (
                        <img
                          src={`${API_BASE}/people/faces/${person.cover_face_id}/crop`}
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
                      {person.relationship_type || "Friend"}
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
                  (Representative Medoid Clustering • Name once to tag all photos)
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
                  const currentRel = tagRelationships[cluster.cluster_id] || "Friend";
                  const isClose = !!tagCloseOnes[cluster.cluster_id];

                  return (
                    <div
                      key={cluster.cluster_id}
                      className="glass-panel"
                      style={{
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

                      {/* Fixed 4-Slot Anchor Faces Grid (Consistent size for all cards with transparent placeholders) */}
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
                                  style={{
                                    position: "relative",
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    borderRadius: "var(--radius-sm)",
                                    overflow: "hidden",
                                    backgroundColor: "var(--bg-sidebar)",
                                  }}
                                >
                                  <img
                                    src={`${API_BASE}/people/faces/${faceId}/crop`}
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
                                      title="Representative Medoid Face"
                                      style={{
                                        position: "absolute",
                                        bottom: "4px",
                                        left: "4px",
                                        backgroundColor: "rgba(0, 0, 0, 0.7)",
                                        padding: "2px 5px",
                                        borderRadius: "3px",
                                        fontSize: "9px",
                                        fontWeight: 600,
                                        color: "var(--accent-primary)",
                                      }}
                                    >
                                      Medoid
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
                          <input
                            type="text"
                            list="existing-people-datalist"
                            placeholder="Enter person name (e.g. Maya, David)..."
                            value={currentName}
                            onChange={(e) => handleNameChange(cluster.cluster_id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleTagCluster(cluster);
                            }}
                            style={{
                              flex: 1,
                              padding: "9px 12px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--bg-sidebar)",
                              border: "1px solid var(--border-subtle)",
                              color: "var(--text-primary)",
                              fontSize: "12px",
                              outline: "none",
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
                                <span>Existing person: <strong>{matched.name}</strong> ({matched.relationship_type || "Friend"}). Tagging will merge photos into their profile.</span>
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
                              backgroundColor: currentName.trim() ? "var(--accent-primary)" : "var(--bg-surface-elevated)",
                              border: "none",
                              color: currentName.trim() ? "#ffffff" : "var(--text-muted)",
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
                            title="Dismiss false positive detection (not a real face)"
                            className="clickable"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              padding: "9px 12px",
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
                              <UserX size={13} />
                            )}
                            Not a Face
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
                            src={`${API_BASE}/people/faces/${person.cover_face_id}/crop`}
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
                          value={person.relationship_type || "Friend"}
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
                  backgroundColor: "var(--accent-primary)",
                  border: "none",
                  color: "#ffffff",
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
    </div>
  );
};
