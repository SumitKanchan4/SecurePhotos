import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  FileText, 
  Search, 
  Lock, 
  Receipt, 
  CreditCard, 
  FileCheck2, 
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Scale,
  Tag,
  CheckCircle2
} from "lucide-react";
import { DocumentItem, DocumentCategory, DocumentScanResult } from "../types";
import { useAppStore } from "../store/useAppStore";

const API_BASE = "http://127.0.0.1:8000/api";

interface DocumentsViewProps {
  onDocumentClick?: (index: number, documents: DocumentItem[]) => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({ onDocumentClick }) => {
  const { showToast } = useAppStore();
  const [activeCategory, setActiveCategory] = useState<DocumentCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [activeDocForEdit, setActiveDocForEdit] = useState<DocumentItem | null>(null);

  const categoryRibbonRef = useRef<HTMLDivElement>(null);

  // Load documents from backend
  const fetchDocuments = useCallback(async (cat: DocumentCategory = activeCategory, query: string = searchQuery) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (cat !== "all") params.append("category", cat);
      if (query.trim()) params.append("q", query.trim());

      const res = await fetch(`${API_BASE}/documents?${params.toString()}`);
      if (res.ok) {
        const data: DocumentItem[] = await res.json();
        setDocuments(data);
      } else {
        console.error("Failed to load documents:", res.statusText);
      }
    } catch (err) {
      console.error("Network error loading documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeCategory, searchQuery]);

  useEffect(() => {
    fetchDocuments(activeCategory, searchQuery);
  }, [activeCategory, searchQuery, fetchDocuments]);

  // Handle on-demand library scan for documents
  const handleScanDocuments = async () => {
    setIsScanning(true);
    try {
      const res = await fetch(`${API_BASE}/documents/scan`, { method: "POST" });
      if (res.ok) {
        const scanRes: DocumentScanResult = await res.json();
        showToast?.(
          scanRes.newly_detected > 0
            ? `Scanned ${scanRes.total_scanned} items • Found ${scanRes.newly_detected} new documents`
            : `Scan complete: All ${scanRes.total_scanned} library items are up to date`,
          "success"
        );
        fetchDocuments(activeCategory, searchQuery);
      }
    } catch (err) {
      console.error("Scan error:", err);
      showToast?.("Error scanning library for documents", "warning");
    } finally {
      setIsScanning(false);
    }
  };

  // Handle re-categorizing a document
  const handleUpdateCategory = async (docId: number, newCategory: string) => {
    try {
      const res = await fetch(`${API_BASE}/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory }),
      });
      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === docId ? { ...d, category: newCategory } : d))
        );
        setActiveDocForEdit(null);
        showToast?.("Document category updated", "success");
      }
    } catch (err) {
      console.error("Error updating category:", err);
      showToast?.("Failed to update category", "warning");
    }
  };

  // Category Icon Resolver
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "receipt":
        return <Receipt size={17} style={{ color: "#10b981" }} />;
      case "identity":
        return <CreditCard size={17} style={{ color: "#3b82f6" }} />;
      case "tax":
        return <FileCheck2 size={17} style={{ color: "#8b5cf6" }} />;
      case "medical":
        return <ShieldAlert size={17} style={{ color: "#ef4444" }} />;
      case "legal":
        return <Scale size={17} style={{ color: "#f59e0b" }} />;
      case "warranty":
        return <ShieldCheck size={17} style={{ color: "#06b6d4" }} />;
      default:
        return <FileText size={17} style={{ color: "var(--accent-primary)" }} />;
    }
  };

  const categoriesList = [
    { id: "all", label: "All Documents" },
    { id: "receipt", label: "Receipts & Bills" },
    { id: "identity", label: "Passports & IDs" },
    { id: "tax", label: "Tax & Financial" },
    { id: "medical", label: "Medical & Health" },
    { id: "legal", label: "Legal & Contracts" },
    { id: "warranty", label: "Warranties & Manuals" },
  ];

  return (
    <div 
      style={{ 
        flex: 1, 
        overflowY: "auto", 
        display: "flex", 
        flexDirection: "column", 
        gap: "16px",
        height: "100%",
        scrollbarGutter: "stable"
      }}
    >
      {/* ── Section 4 Compliant Sticky Liquid-Glass Header ──────────────────── */}
      <div 
        className="liquid-glass-toolbar"
        style={{ 
          margin: "14px 24px 0 24px",
          padding: "12px 20px",
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
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
        {/* Left Column (flex: 1): Status Capsule */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "120px" }}>
          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              color: "var(--accent-success)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
            }}
          >
            <CheckCircle2 size={12} style={{ color: "var(--accent-success)" }} />
            On-Device OCR & Vault Safe
          </span>
        </div>

        {/* Center Column (flex: 0 1 auto): Centered Title & Inline Frosted Capsule Badge */}
        <div 
          style={{ 
            flex: "0 1 auto", 
            display: "flex", 
            alignItems: "baseline", 
            justifyContent: "center", 
            gap: "10px", 
            minWidth: 0 
          }}
        >
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 800,
              fontFamily: "Plus Jakarta Sans, sans-serif",
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              margin: 0,
              whiteSpace: "nowrap",
            }}
          >
            Documents & Receipts
          </h1>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-badge-bg)",
              border: "1px solid var(--glass-badge-border)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--text-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {documents.length} {documents.length === 1 ? "document" : "documents"}
          </span>
        </div>

        {/* Right Column (flex: 1): Search & Scan Triggers */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", minWidth: "160px" }}>
          {/* Real-time OCR Search */}
          <div 
            style={{
              width: "100%",
              maxWidth: "200px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 12px",
              backgroundColor: "var(--glass-pill-bg)",
              borderRadius: "var(--radius-full)",
              border: "1px solid var(--glass-border)",
            }}
          >
            <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search OCR text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
                minWidth: 0,
              }}
            />
          </div>

          {/* 1-Click Scan Documents Button */}
          <button
            onClick={handleScanDocuments}
            disabled={isScanning}
            className="clickable"
            title="Scan library for receipts and documents"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--glass-pill-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isScanning ? "wait" : "pointer",
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
          >
            <RefreshCw size={13} className={isScanning ? "spin" : ""} style={{ color: "var(--accent-primary)" }} />
            <span>{isScanning ? "Scanning..." : "Scan Documents"}</span>
          </button>
        </div>
      </div>

      {/* ── Dedicated Category Tags Horizontal Ribbon ───────────────────────── */}
      <div 
        ref={categoryRibbonRef}
        onWheel={(e) => {
          if (categoryRibbonRef.current) {
            categoryRibbonRef.current.scrollLeft += e.deltaY;
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          overflowX: "auto",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
          padding: "0 24px",
        }}
      >
        {categoriesList.map((cat) => {
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id as DocumentCategory)}
              className="clickable"
              style={{
                flexShrink: 0,
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                border: isSelected 
                  ? "1px solid var(--glass-border-highlight)" 
                  : "1px solid var(--glass-border)",
                backgroundColor: isSelected 
                  ? "var(--glass-pill-active)" 
                  : "var(--glass-pill-bg)",
                color: isSelected 
                  ? "var(--text-primary)" 
                  : "var(--text-secondary)",
                fontSize: "12px",
                fontWeight: isSelected ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: isSelected ? "var(--glass-shadow)" : "none",
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: "0 24px 32px 24px" }}>
        {isLoading && documents.length === 0 ? (
          <div 
            style={{ 
              marginTop: "80px", 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              gap: "12px", 
              color: "var(--text-secondary)" 
            }}
          >
            <RefreshCw size={24} className="spin" style={{ color: "var(--accent-primary)" }} />
            <span style={{ fontSize: "13px" }}>Loading Document Vault...</span>
          </div>
        ) : documents.length === 0 ? (
          /* Human-Centric Empty State */
          <div 
            style={{
              marginTop: "60px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "40px 20px",
              backgroundColor: "var(--glass-surface)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--glass-border)",
              maxWidth: "520px",
              margin: "60px auto 0 auto",
            }}
          >
            <div 
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-primary)",
                marginBottom: "16px",
              }}
            >
              <FileText size={28} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 6px 0", color: "var(--text-primary)" }}>
              No Documents Detected
            </h3>
            <p style={{ fontSize: "13px", margin: 0, maxWidth: "380px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
              Receipts, bills, tax forms, IDs, and invoices are automatically classified with on-device text indexing.
            </p>
            <button
              onClick={handleScanDocuments}
              disabled={isScanning}
              className="clickable"
              style={{
                marginTop: "18px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 18px",
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--accent-primary)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              }}
            >
              <RefreshCw size={14} className={isScanning ? "spin" : ""} />
              <span>{isScanning ? "Scanning Library..." : "Scan Library for Documents"}</span>
            </button>
          </div>
        ) : (
          /* Documents Card Grid */
          <div 
            style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", 
              gap: "16px" 
            }}
          >
            {documents.map((doc, idx) => (
              <div
                key={doc.id}
                className="glass-panel"
                style={{
                  borderRadius: "var(--radius-lg)",
                  backgroundColor: "var(--glass-surface)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "var(--glass-shadow)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  position: "relative",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                }}
              >
                {/* Header row: Icon, Title, Date, Encrypted Flag */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                    <div 
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: doc.is_encrypted ? "rgba(139, 92, 246, 0.15)" : "var(--glass-pill-bg)",
                        border: "1px solid var(--glass-border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {getCategoryIcon(doc.category)}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <h3 
                        style={{ 
                          fontSize: "14px", 
                          fontWeight: 700, 
                          color: "var(--text-primary)", 
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.title}
                      </h3>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginTop: "2px" }}>
                        {doc.date || "Unknown date"} • {doc.file_size}
                      </span>
                    </div>
                  </div>

                  {doc.is_encrypted && (
                    <span 
                      title="Secured inside Private Vault"
                      style={{
                        backgroundColor: "rgba(139, 92, 246, 0.15)",
                        border: "1px solid rgba(139, 92, 246, 0.3)",
                        color: "var(--accent-vault)",
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        flexShrink: 0,
                      }}
                    >
                      <Lock size={10} /> VAULT
                    </span>
                  )}
                </div>

                {/* Document Thumbnail Preview (Clickable to Lightbox) */}
                <div 
                  onClick={() => onDocumentClick?.(idx, documents)}
                  className="clickable"
                  style={{
                    width: "100%",
                    height: "150px",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    backgroundColor: "rgba(0, 0, 0, 0.1)",
                    border: "1px solid var(--glass-border)",
                    cursor: "pointer",
                    position: "relative",
                  }}
                >
                  <img
                    src={`${API_BASE}/photos/${doc.id}/thumbnail`}
                    alt={doc.title}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transition: "transform 0.2s ease",
                    }}
                    onError={(e) => {
                      // Fallback placeholder if thumbnail fails
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <div 
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      right: "8px",
                      backgroundColor: "rgba(0, 0, 0, 0.5)",
                      backdropFilter: "blur(8px)",
                      borderRadius: "var(--radius-full)",
                      padding: "3px 8px",
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <ExternalLink size={10} /> View Scan
                  </div>
                </div>

                {/* OCR Extracted Text Preview Snippet */}
                <div 
                  style={{
                    backgroundColor: "var(--glass-pill-bg)",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--glass-border)",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-secondary)",
                    lineHeight: "1.4",
                    maxHeight: "56px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>OCR Text: </span>
                  {doc.extracted_text ? doc.extracted_text : <span style={{ fontStyle: "italic", opacity: 0.6 }}>Standard document scan</span>}
                </div>

                {/* Footer Actions: Category Tag & Open */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "2px" }}>
                  {/* Category Pill Switcher */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setActiveDocForEdit(activeDocForEdit?.id === doc.id ? null : doc)}
                      className="clickable"
                      style={{
                        padding: "3px 8px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--glass-badge-bg)",
                        border: "1px solid var(--glass-badge-border)",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <Tag size={10} />
                      <span style={{ textTransform: "capitalize" }}>{doc.category}</span>
                    </button>

                    {/* Popover to switch category */}
                    {activeDocForEdit?.id === doc.id && (
                      <div 
                        style={{
                          position: "absolute",
                          bottom: "100%",
                          left: 0,
                          marginBottom: "6px",
                          backgroundColor: "var(--glass-surface)",
                          backdropFilter: "blur(28px)",
                          border: "1px solid var(--glass-border)",
                          borderRadius: "var(--radius-md)",
                          boxShadow: "var(--glass-shadow)",
                          padding: "6px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "3px",
                          zIndex: 50,
                          minWidth: "140px",
                        }}
                      >
                        {["receipt", "identity", "tax", "medical", "legal", "warranty", "other"].map((cat) => (
                          <button
                            key={cat}
                            onClick={() => handleUpdateCategory(doc.id, cat)}
                            className="clickable"
                            style={{
                              textAlign: "left",
                              padding: "4px 8px",
                              borderRadius: "var(--radius-sm)",
                              border: "none",
                              backgroundColor: doc.category === cat ? "var(--glass-pill-active)" : "transparent",
                              color: "var(--text-primary)",
                              fontSize: "11px",
                              cursor: "pointer",
                              textTransform: "capitalize",
                            }}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => onDocumentClick?.(idx, documents)}
                    className="clickable"
                    style={{
                      padding: "4px 12px",
                      borderRadius: "var(--radius-full)",
                      backgroundColor: "var(--glass-pill-bg)",
                      border: "1px solid var(--glass-border)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      cursor: "pointer",
                    }}
                  >
                    <span>Inspect</span>
                    <ExternalLink size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
