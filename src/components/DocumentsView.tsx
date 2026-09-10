import React, { useState, useRef } from "react";
import { 
  FileText, 
  Search, 
  Lock, 
  Receipt, 
  CreditCard, 
  FileCheck2, 
  ExternalLink 
} from "lucide-react";

interface DocumentItem {
  id: number;
  title: string;
  category: "receipt" | "identity" | "tax" | "medical";
  date: string;
  extractedText: string;
  fileSize: string;
  isEncrypted: boolean;
}

export const DocumentsView: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const categoryRibbonRef = useRef<HTMLDivElement>(null);

  const [documents] = useState<DocumentItem[]>([]);

  const filteredDocs = documents.filter((doc) => {
    const matchesCat = activeCategory === "all" || doc.category === activeCategory;
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.extractedText.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Unified Compact Glassmorphic Header Bar */}
      <div 
        className="liquid-glass-toolbar"
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          gap: "12px",
          padding: "12px 20px",
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
        {/* Left Column: Vault Indicator */}
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
            <FileCheck2 size={12} style={{ color: "var(--accent-success)" }} />
            OCR Document Vault
          </span>
        </div>

        {/* Center Column: Centered Title & Inline Frosted Capsule Badge */}
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

          {/* Inline Frosted Capsule Badge for Document Count */}
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
            {filteredDocs.length} {filteredDocs.length === 1 ? "document" : "documents"}
          </span>
        </div>

        {/* Right Column: OCR Search Bar */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", minWidth: "160px" }}>
          <div 
            style={{
              width: "100%",
              maxWidth: "240px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
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
        </div>
      </div>

      {/* Dedicated Category Tags Horizontal Ribbon (with mouse wheel scroll) */}
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
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
          padding: "2px 0",
        }}
      >
        {[
          { id: "all", label: "All Documents" },
          { id: "receipt", label: "Receipts & Bills" },
          { id: "identity", label: "Passports & IDs" },
          { id: "tax", label: "Tax & Financial" },
          { id: "medical", label: "Medical & Health" },
          { id: "legal", label: "Legal & Contracts" },
          { id: "warranty", label: "Warranties & Manuals" },
        ].map((cat) => {
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
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

      {filteredDocs.length === 0 ? (
        <div 
          style={{
            marginTop: "60px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          <FileText size={48} style={{ opacity: 0.3, marginBottom: "12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 600 }}>No Documents Detected</p>
          <p style={{ fontSize: "12px", marginTop: "4px", maxWidth: "380px" }}>
            Images containing receipts, invoices, passports, or forms will be automatically detected and full-text indexed via on-device OCR.
          </p>
        </div>
      ) : (
        /* Documents List / Card View */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "16px" }}>
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="glass-panel"
              style={{
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div 
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: doc.isEncrypted ? "rgba(139, 92, 246, 0.15)" : "var(--bg-surface-elevated)",
                      color: doc.isEncrypted ? "var(--accent-vault)" : "var(--accent-primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {doc.category === "receipt" ? <Receipt size={18} /> : 
                     doc.category === "identity" ? <CreditCard size={18} /> : 
                     doc.category === "tax" ? <FileCheck2 size={18} /> : <FileText size={18} />}
                  </div>

                  <div>
                    <h3 style={{ fontSize: "14px", fontWeight: 700 }}>{doc.title}</h3>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {doc.date} • {doc.fileSize}
                    </span>
                  </div>
                </div>

                {doc.isEncrypted && (
                  <span 
                    title="Encrypted in Zero-Trust Vault"
                    style={{
                      backgroundColor: "var(--accent-vault)",
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: "var(--radius-xs)",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                    }}
                  >
                    <Lock size={10} /> ENCRYPTED
                  </span>
                )}
              </div>

              {/* OCR Extracted Text Snippet */}
              <div 
                style={{
                  backgroundColor: "var(--bg-sidebar)",
                  padding: "10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-secondary)",
                  lineHeight: "1.4",
                }}
              >
                <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>OCR Extracted: </span>
                {doc.extractedText}
              </div>

              {/* Document Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
                <button
                  className="clickable"
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <ExternalLink size={12} />
                  Open Scan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
