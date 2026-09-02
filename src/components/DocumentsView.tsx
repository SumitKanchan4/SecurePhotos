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

  const [documents] = useState<DocumentItem[]>([
    {
      id: 1,
      title: "Apple Store MacBook Pro Invoice",
      category: "receipt",
      date: "2026-08-14",
      extractedText: "Apple Inc. Order #W984210. Total: $2,499.00 USD. Payment Method: Apple Card.",
      fileSize: "1.4 MB",
      isEncrypted: false,
    },
    {
      id: 2,
      title: "International Passport Scan (Sumit)",
      category: "identity",
      date: "2025-11-20",
      extractedText: "REPUBLIC OF INDIA PASSPORT. Document No: Z9104821. Expiry: 2035.",
      fileSize: "3.2 MB",
      isEncrypted: true,
    },
    {
      id: 3,
      title: "Annual Federal Tax Return Form 1040",
      category: "tax",
      date: "2026-04-12",
      extractedText: "Department of the Treasury Internal Revenue Service. 1040 U.S. Individual Income Tax Return.",
      fileSize: "4.8 MB",
      isEncrypted: true,
    },
    {
      id: 4,
      title: "Health & Dental Insurance Policy Card",
      category: "medical",
      date: "2026-01-05",
      extractedText: "BlueCross Health Network. Policy #BC-4901928-A. Group #88391.",
      fileSize: "2.1 MB",
      isEncrypted: false,
    },
  ]);

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

      {/* Documents List / Card View */}
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
    </div>
  );
};
