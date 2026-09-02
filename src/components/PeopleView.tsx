import React, { useState } from "react";
import { 
  Users, 
  Sparkles, 
  Star, 
  Check, 
  Smile, 
  Sun, 
  Glasses, 
  Camera 
} from "lucide-react";
import { PersonItem } from "../types";

interface UnlabeledCluster {
  clusterId: string;
  photoCount: number;
  anchorFaces: { label: string; icon: React.ReactNode }[];
}

export const PeopleView: React.FC = () => {
  const [people, setPeople] = useState<PersonItem[]>([
    { id: 1, name: "Alice", affinity_score: 94.2, relationship_type: "Daughter", is_close_one: true, confirmed_count: 1420 },
    { id: 2, name: "Bob", affinity_score: 88.5, relationship_type: "Partner", is_close_one: true, confirmed_count: 980 },
    { id: 3, name: "Grandma Evelyn", affinity_score: 72.0, relationship_type: "Family", is_close_one: true, confirmed_count: 340 },
    { id: 4, name: "David", affinity_score: 42.1, relationship_type: "Friend", is_close_one: false, confirmed_count: 85 },
  ]);

  const [unlabeledClusters, setUnlabeledClusters] = useState<UnlabeledCluster[]>([
    {
      clusterId: "cluster_904",
      photoCount: 412,
      anchorFaces: [
        { label: "Portrait", icon: <Smile size={18} /> },
        { label: "Side Profile", icon: <Camera size={18} /> },
        { label: "Outdoor", icon: <Sun size={18} /> },
        { label: "Glasses", icon: <Glasses size={18} /> },
      ],
    },
  ]);

  const [newTagNames, setNewTagNames] = useState<{ [key: string]: string }>({});

  const handleTagCluster = (clusterId: string, count: number) => {
    const name = newTagNames[clusterId]?.trim();
    if (!name) return;

    const newPerson: PersonItem = {
      id: Date.now(),
      name,
      affinity_score: 75.0,
      relationship_type: "Friend",
      is_close_one: true,
      confirmed_count: count,
    };

    setPeople((prev) => [newPerson, ...prev]);
    setUnlabeledClusters((prev) => prev.filter((c) => c.clusterId !== clusterId));
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
      {/* Section 1: Unsupervised Face Clusters ("Name Once, Tag 1,000 Photos") */}
      {unlabeledClusters.length > 0 && (
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <Sparkles size={18} style={{ color: "var(--accent-primary)" }} />
            <h2 style={{ fontSize: "16px", fontWeight: 700 }}>Unlabeled Face Clusters Found</h2>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              (Representative Medoid Clustering • Name once to tag all photos)
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "16px" }}>
            {unlabeledClusters.map((cluster) => (
              <div
                key={cluster.clusterId}
                className="glass-panel"
                style={{
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  backgroundColor: "var(--bg-surface)",
                  border: "1px solid var(--border-highlight)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 600 }}>Who is this person?</h3>
                  <span 
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-primary)",
                      backgroundColor: "var(--accent-glow)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      fontWeight: 600,
                    }}
                  >
                    Found in {cluster.photoCount} photos
                  </span>
                </div>

                {/* 4 Diverse Anchor Medoids */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {cluster.anchorFaces.map((face, idx) => (
                    <div
                      key={idx}
                      style={{
                        height: "80px",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        border: "1px solid var(--border-subtle)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {face.icon}
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{face.label}</span>
                    </div>
                  ))}
                </div>

                {/* Tag Input & 1-Click Confirm */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Enter person name (e.g. Charlie)"
                    value={newTagNames[cluster.clusterId] || ""}
                    onChange={(e) => setNewTagNames({ ...newTagNames, [cluster.clusterId]: e.target.value })}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-sidebar)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => handleTagCluster(cluster.clusterId, cluster.photoCount)}
                    className="clickable"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 16px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-primary)",
                      border: "none",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    <Check size={14} />
                    Tag {cluster.photoCount} Photos
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 2: Recognized People Gallery & Social Affinity */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <Users size={18} style={{ color: "var(--accent-primary)" }} />
          <h2 style={{ fontSize: "16px", fontWeight: 700 }}>Recognized People ({people.length})</h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
          {people.map((person) => (
            <div
              key={person.id}
              className="clickable glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                padding: "16px",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                position: "relative",
              }}
            >
              {/* Close One Star Badge */}
              {person.is_close_one && (
                <div 
                  title="Close One (High Social Affinity)"
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    color: "var(--accent-warning)",
                  }}
                >
                  <Star size={16} fill="var(--accent-warning)" />
                </div>
              )}

              {/* Avatar Circle */}
              <div 
                style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--bg-surface-elevated)",
                  border: "2px solid var(--accent-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent-primary)",
                  marginBottom: "12px",
                }}
              >
                <Users size={32} />
              </div>

              <h3 style={{ fontSize: "15px", fontWeight: 700 }}>{person.name}</h3>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                {person.relationship_type || "Friend"} • {person.confirmed_count.toLocaleString()} photos
              </p>

              {/* Affinity Score Pill */}
              <div 
                style={{
                  marginTop: "12px",
                  padding: "3px 10px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: person.is_close_one ? "rgba(16, 185, 129, 0.12)" : "var(--bg-sidebar)",
                  color: person.is_close_one ? "var(--accent-success)" : "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                Affinity: {person.affinity_score}/100
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
