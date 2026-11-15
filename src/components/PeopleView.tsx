import React, { useState, useEffect, useCallback } from "react";
import { Loader2, X, Eye } from "lucide-react";
import { PersonItem, UnlabeledClusterItem, FaceScanStatus, TimelinePhoto } from "../types";
import { useAppStore } from "../store/useAppStore";
import { PeopleOverview } from "./people/PeopleOverview";
import { PersonPage } from "./people/PersonPage";
import { apiFetch, getApiUrl } from "../services/api";

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
  /** Opens photos in the viewer (the same path as Photos, so details load in full). */
  onOpenPhotos?: (photos: TimelinePhoto[], index: number) => void;
  onToggleFavorite?: (photoId: number) => void;
}

export const PeopleView: React.FC<PeopleViewProps> = ({
  onOpenPhotos,
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
    // The person page reloads its own photos on the same event (people/PersonPage.tsx).
    const handlePhotosChanged = () => {
      fetchPeople();
      fetchClusters();
    };

    window.addEventListener("photos-changed", handlePhotosChanged);
    return () => {
      window.removeEventListener("photos-changed", handlePhotosChanged);
    };
  }, [fetchPeople, fetchClusters]);

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

  // Open a person's page (R10: the page itself is people/PersonPage.tsx).
  const handleSelectPerson = (person: PersonItem) => setSelectedPerson(person);

  // A person opened from Search or the viewer (R9c): show their page once People has loaded.
  const pendingOpen = useAppStore((st) => st.pendingOpen);
  useEffect(() => {
    if (pendingOpen?.kind !== "person") return;
    const person = people.find((p) => p.id === pendingOpen.id);
    if (person) {
      useAppStore.getState().clearPendingOpen();
      handleSelectPerson(person);
    } else if (!isLoading) {
      useAppStore.getState().clearPendingOpen();
    }
  }, [pendingOpen, people, isLoading]);

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
        <PersonPage
          person={selectedPerson}
          takenNames={people.map((p) => p.name)}
          onBack={() => setSelectedPerson(null)}
          onChanged={(updated) => {
            setSelectedPerson(updated);
            setPeople((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
          }}
          onDeleted={() => {
            setSelectedPerson(null);
            fetchPeople();
            fetchClusters();
          }}
          onOpenPhotos={(list, index) => onOpenPhotos?.(list, index)}
          onToggleFavorite={onToggleFavorite}
        />
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
