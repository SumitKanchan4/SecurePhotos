import React, { useState } from "react";
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

  const [documents] = useState<DocumentItem[]>([]);

  const filteredDocs = documents.filter((doc) => {
    const matchesCat = activeCategory === "all" || doc.category === activeCategory;
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.extractedText.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
      {/* Header */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          marginBottom: "16px" 
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FileText size={20} style={{ color: "var(--accent-primary)" }} />
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700 }}>Documents & Receipts ({documents.length})</h2>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              OCR-scanned text indexed in SQLite FTS5 • Isolated from standard photo timeline
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar & OCR Search */}
      <div 
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        {/* Category Pills */}
        <div style={{ display: "flex", gap: "6px" }}>
          {[
            { id: "all", label: "All Documents" },
            { id: "receipt", label: "Receipts & Invoices" },
            { id: "identity", label: "Passports & IDs" },
            { id: "tax", label: "Tax & Financial" },
            { id: "medical", label: "Medical & Health" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="clickable"
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                border: "none",
                backgroundColor: activeCategory === cat.id ? "var(--accent-primary)" : "var(--bg-surface)",
                color: activeCategory === cat.id ? "#ffffff" : "var(--text-secondary)",
                fontSize: "12px",
                fontWeight: activeCategory === cat.id ? 600 : 400,
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* OCR Search Bar */}
        <div 
          style={{
            flex: 1,
            minWidth: "220px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            backgroundColor: "var(--bg-surface)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Search OCR extracted text (e.g. Order #, Total $, SSN)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "var(--text-primary)",
              fontSize: "12px",
              outline: "none",
            }}
          />
        </div>
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
