import React, { useState, useEffect, useCallback } from "react";
import { 
  Users, 
  Sparkles,
  Check,
  Star,
  RefreshCw,
  Search,
  ArrowLeft,
  Image as ImageIcon,
  Heart,
  Loader2
} from "lucide-react";
import { PersonItem, UnlabeledClusterItem, FaceScanStatus, PhotoItem } from "../types";

const API_BASE = "http://127.0.0.1:8000/api";

const RELATIONSHIP_OPTIONS = [
  "Friend",
  "Family",
  "Partner",
  "Colleague",
  "Acquaintance",
];

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
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Tagging form state per cluster
  const [tagNames, setTagNames] = useState<{ [clusterId: string]: string }>({});
  const [tagRelationships, setTagRelationships] = useState<{ [clusterId: string]: string }>({});
  const [tagCloseOnes, setTagCloseOnes] = useState<{ [clusterId: string]: boolean }>({});
  const [submittingCluster, setSubmittingCluster] = useState<string | null>(null);

  // Selected person detail view (viewing photos of a person)
  const [selectedPerson, setSelectedPerson] = useState<PersonItem | null>(null);
  const [personPhotos, setPersonPhotos] = useState<PhotoItem[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState<boolean>(false);

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
    try {
      const res = await fetch(`${API_BASE}/people/scan`, { method: "POST" });
      if (res.ok) {
        const statusData: FaceScanStatus = await res.json();
        setScanStatus(statusData);
      }
    } catch (err) {
      console.error("Failed to trigger face scan:", err);
    }
  };

  // 1-Click Tag Cluster ("Name Once, Tag 1,000 Photos")
  const handleTagCluster = async (cluster: UnlabeledClusterItem) => {
    const name = (tagNames[cluster.cluster_id] || "").trim();
    if (!name) return;

    setSubmittingCluster(cluster.cluster_id);
    try {
      const res = await fetch(`${API_BASE}/people/tag-cluster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster_id: cluster.cluster_id,
          name,
          relationship_type: tagRelationships[cluster.cluster_id] || "Friend",
          is_close_one: !!tagCloseOnes[cluster.cluster_id],
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

  const filteredPeople = people.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                    width: "48px",
                    height: "48px",
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
                    <Users size={24} style={{ color: "var(--accent-primary)" }} />
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h1 style={{ fontSize: "20px", fontWeight: 700 }}>{selectedPerson.name}</h1>
                    {selectedPerson.is_close_one && (
                      <Star size={16} fill="var(--accent-warning)" color="var(--accent-warning)" />
                    )}
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {selectedPerson.relationship_type || "Friend"} • {personPhotos.length} Photos Found
                  </p>
                </div>
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
          {/* Header Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Users size={24} style={{ color: "var(--accent-primary)" }} />
                <h1 style={{ fontSize: "22px", fontWeight: 700 }}>People & Social Affinity</h1>
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
                High-Accuracy On-Device Face Recognition (YOLOv8 + ArcFace 512-D) • 100% Private
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Search Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <Search size={14} style={{ color: "var(--text-muted)" }} />
                <input
                  type="text"
                  placeholder="Search recognized people..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    border: "none",
                    outline: "none",
                    backgroundColor: "transparent",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    width: "180px",
                  }}
                />
              </div>

              {/* Scan Trigger Button */}
              <button
                onClick={handleTriggerScan}
                disabled={scanStatus.is_scanning}
                className="clickable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: scanStatus.is_scanning ? "var(--bg-surface-elevated)" : "var(--accent-primary)",
                  border: "1px solid var(--border-highlight)",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  opacity: scanStatus.is_scanning ? 0.7 : 1,
                  cursor: scanStatus.is_scanning ? "default" : "pointer",
                }}
              >
                <RefreshCw size={14} className={scanStatus.is_scanning ? "spinning" : ""} />
                {scanStatus.is_scanning ? "Scanning Library..." : "Scan Photos for Faces"}
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

          {/* Section 1: Unlabeled Face Clusters ("Name Once, Tag 1,000 Photos") */}
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

                      {/* 4 Diverse Anchor Medoid Avatar Crops */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
                        {(cluster.anchor_face_ids.length > 0 ? cluster.anchor_face_ids : [cluster.medoid_face_id]).filter(Boolean).map((faceId, idx) => (
                          <div
                            key={idx}
                            style={{
                              aspectRatio: "1",
                              borderRadius: "var(--radius-sm)",
                              overflow: "hidden",
                              backgroundColor: "var(--bg-surface-elevated)",
                              border: idx === 0 ? "2px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
                              position: "relative",
                            }}
                          >
                            <img
                              src={`${API_BASE}/people/faces/${faceId}/crop`}
                              alt={`Face ${faceId}`}
                              loading="lazy"
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                            {idx === 0 && (
                              <div
                                style={{
                                  position: "absolute",
                                  bottom: "2px",
                                  left: "2px",
                                  backgroundColor: "rgba(0,0,0,0.75)",
                                  color: "var(--accent-primary)",
                                  fontSize: "9px",
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                }}
                              >
                                Anchor
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Inputs: Name, Relationship, Close One Toggle */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <input
                            type="text"
                            placeholder="Enter person name (e.g. Alex, Maya)..."
                            value={currentName}
                            onChange={(e) => setTagNames({ ...tagNames, [cluster.cluster_id]: e.target.value })}
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

                          <select
                            value={currentRel}
                            onChange={(e) => setTagRelationships({ ...tagRelationships, [cluster.cluster_id]: e.target.value })}
                            style={{
                              padding: "9px 10px",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "var(--bg-sidebar)",
                              border: "1px solid var(--border-subtle)",
                              color: "var(--text-primary)",
                              fontSize: "12px",
                              outline: "none",
                            }}
                          >
                            {RELATIONSHIP_OPTIONS.map((rel) => (
                              <option key={rel} value={rel}>{rel}</option>
                            ))}
                          </select>

                          {/* Close One Star Toggle */}
                          <button
                            title={isClose ? "Marked as Close One" : "Mark as Close One (VIP)"}
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

                        {/* 1-Click Action Button */}
                        <button
                          onClick={() => handleTagCluster(cluster)}
                          disabled={!currentName.trim() || isSubmitting}
                          className="clickable"
                          style={{
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
                          Tag All {cluster.photo_count} Photos as "{currentName.trim() || "..."}"
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Recognized People Gallery */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <Users size={18} style={{ color: "var(--accent-primary)" }} />
              <h2 style={{ fontSize: "16px", fontWeight: 700 }}>
                Recognized People ({filteredPeople.length})
              </h2>
            </div>

            {filteredPeople.length === 0 ? (
              unlabeledClusters.length === 0 && !scanStatus.is_scanning ? (
                <div
                  style={{
                    padding: "60px 20px",
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
                  <Users size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
                  <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
                    No People Identified Yet
                  </p>
                  <p style={{ fontSize: "12px", marginTop: "6px", maxWidth: "420px", lineHeight: "1.5" }}>
                    Click "Scan Photos for Faces" above to run on-device facial detection across your media library.
                  </p>
                  <button
                    onClick={handleTriggerScan}
                    className="clickable"
                    style={{
                      marginTop: "16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 18px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-primary)",
                      border: "none",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    <RefreshCw size={14} />
                    Scan Library Now
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  <p style={{ fontSize: "13px" }}>No recognized people match "{searchQuery}"</p>
                </div>
              )
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: "16px",
                }}
              >
                {filteredPeople.map((person) => (
                  <div
                    key={person.id}
                    onClick={() => handleSelectPerson(person)}
                    className="clickable glass-panel"
                    style={{
                      borderRadius: "var(--radius-md)",
                      padding: "18px 16px",
                      backgroundColor: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      position: "relative",
                      transition: "transform 0.15s ease, border-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.borderColor = "var(--border-highlight)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.borderColor = "var(--border-subtle)";
                    }}
                  >
                    {/* Close One Star Badge */}
                    {person.is_close_one && (
                      <div
                        title="Close One (High Affinity)"
                        style={{
                          position: "absolute",
                          top: "12px",
                          right: "12px",
                          color: "var(--accent-warning)",
                        }}
                      >
                        <Star size={16} fill="var(--accent-warning)" />
                      </div>
                    )}

                    {/* Avatar Circle */}
                    <div
                      style={{
                        width: "80px",
                        height: "80px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        border: "2px solid var(--accent-primary)",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: "12px",
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
                        <Users size={32} style={{ color: "var(--accent-primary)" }} />
                      )}
                    </div>

                    <h3 style={{ fontSize: "15px", fontWeight: 700 }}>{person.name}</h3>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {person.relationship_type || "Friend"} • {person.confirmed_count} {person.confirmed_count === 1 ? "photo" : "photos"}
                    </p>

                    {/* Affinity Score Pill */}
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "3px 10px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: person.is_close_one ? "rgba(16, 185, 129, 0.12)" : "var(--bg-sidebar)",
                        color: person.is_close_one ? "var(--accent-success)" : "var(--text-muted)",
                        fontSize: "11px",
                        fontWeight: 600,
                      }}
                    >
                      Affinity: {Math.round(person.affinity_score)}/100
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
