import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  FileText, 
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
  CheckCircle2,
  Plus,
  Trash2,
  Pin,
  Loader2
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { DocumentItem, DocumentCategory, DocumentScanResult } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";

interface DocumentsViewProps {
  onDocumentClick?: (index: number, documents: DocumentItem[]) => void;
  onTogglePin?: (photoId: number) => void;
  onDeleteDocument?: (photoId: number) => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({ 
  onDocumentClick,
  onTogglePin: propTogglePin,
  onDeleteDocument: propDeleteDocument,
}) => {
  const { searchQuery, showToast } = useAppStore();
  const [activeCategory, setActiveCategory] = useState<DocumentCategory>("all");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [activeDocForEdit, setActiveDocForEdit] = useState<DocumentItem | null>(null);

  const categoryRibbonRef = useRef<HTMLDivElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  // Helper to stably sort documents with pinned items anchored at the top
  const sortDocuments = useCallback((items: DocumentItem[]) => {
    return [...items].sort((a, b) => {
      const pinA = a.is_pinned ? 1 : 0;
      const pinB = b.is_pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return (b.date || "").localeCompare(a.date || "");
    });
  }, []);

  // Load documents from backend
  const fetchDocuments = useCallback(async (cat: DocumentCategory = activeCategory, query: string = searchQuery) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (cat !== "all") params.append("category", cat);
      if (query.trim()) params.append("q", query.trim());

      const res = await apiFetch(`/api/documents?${params.toString()}`);
      if (res.ok) {
        const data: DocumentItem[] = await res.json();
        setDocuments(sortDocuments(data));
      } else {
        console.error("Failed to load documents:", res.statusText);
      }
    } catch (err) {
      console.error("Network error loading documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeCategory, searchQuery, sortDocuments]);

  useEffect(() => {
    fetchDocuments(activeCategory, searchQuery);
  }, [activeCategory, searchQuery, fetchDocuments]);

  // Synchronize deletions and pin changes from Lightbox, Trash, or other views
  useEffect(() => {
    const handlePhotosChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ action: string; photoId?: number; is_pinned?: boolean }>;
      const { action, photoId, is_pinned } = customEvent.detail || {};

      if (action === "deleted" && photoId) {
        setDocuments((prev) => prev.filter((d) => d.id !== photoId));
      } else if (action === "pinned" && photoId !== undefined) {
        setDocuments((prev) => {
          const updated = prev.map((d) => (d.id === photoId ? { ...d, is_pinned: Boolean(is_pinned) } : d));
          return sortDocuments(updated);
        });
      } else if (action === "imported") {
        fetchDocuments(activeCategory, searchQuery);
      }
    };

    window.addEventListener("photos-changed", handlePhotosChanged);
    return () => window.removeEventListener("photos-changed", handlePhotosChanged);
  }, [fetchDocuments, activeCategory, searchQuery, sortDocuments]);

  // Handle on-demand library scan for documents
  const handleScanDocuments = async () => {
    setIsScanning(true);
    try {
      const res = await apiFetch("/api/documents/scan", { method: "POST" });
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

  // Direct Ingestion Handlers
  const handleAddDocumentClick = async () => {
    if (isImporting) return;
    try {
      let selectedPaths: string[] | null = null;
      try {
        selectedPaths = await invoke<string[] | null>("select_import_files");
      } catch {
        docFileInputRef.current?.click();
        return;
      }
      if (!selectedPaths || selectedPaths.length === 0) return;
      await handleDirectImportDocuments(selectedPaths);
    } catch (err) {
      console.error("Direct document import dialog error:", err);
      docFileInputRef.current?.click();
    }
  };

  const handleDocFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = (files[i] as any).path;
      if (p) paths.push(p);
    }
    if (paths.length > 0) {
      handleDirectImportDocuments(paths);
    }
    if (docFileInputRef.current) docFileInputRef.current.value = "";
  };

  const handleDirectImportDocuments = async (filePaths: string[]) => {
    setIsImporting(true);
    try {
      const res = await apiFetch("/api/documents/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths: filePaths }),
      });
      if (res.ok) {
        const newDocs: DocumentItem[] = await res.json();
        if (newDocs.length > 0) {
          setDocuments((prev) => {
            const combined = [...newDocs, ...prev.filter((d) => !newDocs.some((n) => n.id === d.id))];
            return sortDocuments(combined);
          });
          showToast?.(
            `Added ${newDocs.length} ${newDocs.length === 1 ? "document" : "documents"} to Documents & Receipts`,
            "success"
          );
          window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "imported" } }));
        }
      } else {
        showToast?.("Failed to import documents", "warning");
      }
    } catch (err) {
      console.error("Direct document import failed:", err);
      showToast?.("Error importing documents", "warning");
    } finally {
      setIsImporting(false);
    }
  };

  // Direct Soft Delete
  const handleDeleteDocument = async (docId: number) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    propDeleteDocument?.(docId);
    try {
      const res = await apiFetch(`/api/photos/${docId}`, { method: "DELETE" });
      if (res.ok) {
        showToast?.("Document moved to Trash (safe for 30 days)", "info");
        window.dispatchEvent(
          new CustomEvent("photos-changed", { detail: { action: "deleted", photoId: docId } })
        );
      } else {
        fetchDocuments(activeCategory, searchQuery);
        showToast?.("Failed to delete document", "warning");
      }
    } catch (err) {
      console.error("Error deleting document:", err);
      fetchDocuments(activeCategory, searchQuery);
      showToast?.("Failed to delete document", "warning");
    }
  };

  // Toggle Document Pin (Permanent anchor at the top)
  const handleTogglePin = async (docId: number) => {
    setDocuments((prev) => {
      const target = prev.find((d) => d.id === docId);
      const nextPinned = target ? !target.is_pinned : true;
      const updated = prev.map((d) => (d.id === docId ? { ...d, is_pinned: nextPinned } : d));
      return sortDocuments(updated);
    });
    propTogglePin?.(docId);

    try {
      const res = await apiFetch(`/api/documents/${docId}/pin`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        showToast?.(data.is_pinned ? "Document pinned to top" : "Document unpinned", "info");
        window.dispatchEvent(
          new CustomEvent("photos-changed", {
            detail: { action: "pinned", photoId: docId, is_pinned: data.is_pinned },
          })
        );
      } else {
        fetchDocuments(activeCategory, searchQuery);
      }
    } catch (err) {
      console.error("Error toggling document pin:", err);
      fetchDocuments(activeCategory, searchQuery);
    }
  };

  // Handle re-categorizing a document
  const handleUpdateCategory = async (docId: number, newCategory: string) => {
    try {
      const res = await apiFetch(`/api/documents/${docId}`, {
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
      {/* Hidden file input for web / fallback ingestion */}
      <input
        ref={docFileInputRef}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
        onChange={handleDocFileInputChange}
        style={{ display: "none" }}
      />

      {/* ── Section 4 Compliant Sticky Liquid-Glass Header ──────────────────── */}
      <div 
        className="liquid-glass-toolbar"
        style={{ 
          margin: "14px 24px 0 24px",
          padding: "12px 20px",
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          gap: "16px",
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
        {/* Left Column (flex: 1): Direct Ingestion Action & Security Capsule */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "10px", minWidth: "140px" }}>
          <button
            onClick={handleAddDocumentClick}
            disabled={isImporting}
            className="clickable"
            title="Import documents or receipts directly"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 600,
              border: "none",
              cursor: isImporting ? "wait" : "pointer",
              boxShadow: "0 2px 8px rgba(59, 130, 246, 0.25)",
              flexShrink: 0,
              transition: "transform 0.15s ease",
            }}
          >
            {isImporting ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
            <span>{isImporting ? "Adding..." : "Add Document"}</span>
          </button>

          <span 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              color: "var(--accent-success)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              whiteSpace: "nowrap",
            }}
          >
            <CheckCircle2 size={12} style={{ color: "var(--accent-success)" }} />
            On-Device OCR
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
            minWidth: 0,
            flexShrink: 0,
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
              flexShrink: 0,
            }}
          >
            {documents.length} {documents.length === 1 ? "document" : "documents"}
          </span>
        </div>

        {/* Right Column (flex: 1): Scan Documents Action */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
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
            <span>{isScanning ? "Scanning Library..." : "Scan Documents"}</span>
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
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button
                onClick={handleAddDocumentClick}
                disabled={isImporting}
                className="clickable"
                style={{
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
                  cursor: isImporting ? "wait" : "pointer",
                  boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
                }}
              >
                {isImporting ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                <span>{isImporting ? "Adding..." : "Add Document"}</span>
              </button>
              <button
                onClick={handleScanDocuments}
                disabled={isScanning}
                className="clickable"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 18px",
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--glass-pill-bg)",
                  color: "var(--text-primary)",
                  fontSize: "13px",
                  fontWeight: 600,
                  border: "1px solid var(--glass-border)",
                  cursor: isScanning ? "wait" : "pointer",
                }}
              >
                <RefreshCw size={14} className={isScanning ? "spin" : ""} />
                <span>{isScanning ? "Scanning..." : "Scan Library"}</span>
              </button>
            </div>
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
                  border: doc.is_pinned ? "1px solid rgba(245, 158, 11, 0.45)" : "1px solid var(--glass-border)",
                  boxShadow: doc.is_pinned ? "0 4px 20px rgba(245, 158, 11, 0.08)" : "var(--glass-shadow)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  position: "relative",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                }}
              >
                {/* Header row: Icon, Title, Date, Encrypted Flag, and Pin Action */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
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

                    <div style={{ minWidth: 0, flex: 1 }}>
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

                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                    {/* Pin to Top Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(doc.id);
                      }}
                      className="clickable"
                      title={doc.is_pinned ? "Unpin document" : "Pin document to top"}
                      style={{
                        padding: "3px 8px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: doc.is_pinned ? "rgba(245, 158, 11, 0.2)" : "var(--glass-pill-bg)",
                        border: doc.is_pinned ? "1px solid rgba(245, 158, 11, 0.5)" : "1px solid var(--glass-border)",
                        color: doc.is_pinned ? "#f59e0b" : "var(--text-muted)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        cursor: "pointer",
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      <Pin size={11} fill={doc.is_pinned ? "#f59e0b" : "none"} />
                      {doc.is_pinned && <span>PINNED</span>}
                    </button>

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
                    src={getThumbnailUrl(doc.id)}
                    alt={doc.title}
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transition: "transform 0.2s ease",
                    }}
                    onError={(e) => {
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

                {/* Footer Actions: Category Tag, Delete, and Inspect */}
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

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {/* Direct Delete Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDocument(doc.id);
                      }}
                      className="clickable"
                      title="Move to Trash (safe for 30 days)"
                      style={{
                        padding: "5px",
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--glass-pill-bg)",
                        border: "1px solid var(--glass-border)",
                        color: "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.color = "var(--accent-danger)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(239, 68, 68, 0.4)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--glass-border)";
                      }}
                    >
                      <Trash2 size={13} />
                    </button>

                    {/* Inspect Button */}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
