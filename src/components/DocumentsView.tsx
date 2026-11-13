/**
 * Documents (redesign R7b, approved board): paper-like cards so documents never look like
 * photos; one row of category chips with counts; pinned papers on top. "Find in photos" looks
 * through the library for receipts and IDs already there; "+ Add" brings in files directly.
 * Vault documents never appear here (they live in Private Vault → Documents).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Pin, Plus, ScanSearch, Search } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { DocumentItem } from "../types";
import { useAppStore } from "../store/useAppStore";
import { apiFetch, getThumbnailUrl } from "../services/api";
import { categoryChips, categoryLabel, documentsLabel, DOCUMENT_CATEGORIES, inCategory, shortDate, sortByDate } from "./documents/docsFormat";

interface DocumentsViewProps {
  onDocumentClick?: (index: number, documents: DocumentItem[]) => void;
}

/* Pinning is done here only: the screen used to also call App's pin handler, so every pin was
   sent twice and cancelled itself out (fixed in R7b). */
export const DocumentsView: React.FC<DocumentsViewProps> = ({ onDocumentClick }) => {
  const { searchQuery, setSearchOpen, showToast } = useAppStore();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [category, setCategory] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append("q", searchQuery.trim());
      const res = await apiFetch(`/api/documents?${params.toString()}`);
      if (res.ok) setDocs(await res.json());
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  // Stay in step with the viewer, Trash and imports elsewhere.
  useEffect(() => {
    const onChange = (e: Event) => {
      const { action, photoId, is_pinned } = (e as CustomEvent<{ action: string; photoId?: number; is_pinned?: boolean }>).detail || {};
      if (action === "deleted" && photoId) setDocs((prev) => prev.filter((d) => d.id !== photoId));
      else if (action === "pinned" && photoId !== undefined) setDocs((prev) => prev.map((d) => (d.id === photoId ? { ...d, is_pinned: Boolean(is_pinned) } : d)));
      else if (action === "imported" || action === "restored") load();
    };
    window.addEventListener("photos-changed", onChange);
    return () => window.removeEventListener("photos-changed", onChange);
  }, [load]);

  useEffect(() => {
    if (menuFor === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuFor]);

  const chips = useMemo(() => categoryChips(docs), [docs]);
  const shown = useMemo(() => sortByDate(docs.filter((d) => inCategory(d, category))), [docs, category]);
  const pinned = shown.filter((d) => d.is_pinned);
  const rest = shown.filter((d) => !d.is_pinned);
  const viewerOrder = useMemo(() => [...pinned, ...rest], [pinned, rest]);

  const findInPhotos = async () => {
    setIsScanning(true);
    try {
      const res = await apiFetch("/api/documents/scan", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showToast(
        data.newly_detected > 0
          ? `Found ${documentsLabel(data.newly_detected)} in your photos.`
          : "No new documents found in your photos.",
        data.newly_detected > 0 ? "success" : "info",
      );
      load();
    } catch {
      showToast("Your photos couldn't be checked right now.", "warning");
    } finally {
      setIsScanning(false);
    }
  };

  const addFiles = async (paths: string[]) => {
    setIsAdding(true);
    try {
      const res = await apiFetch("/api/documents/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_paths: paths }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const added: DocumentItem[] = await res.json();
      showToast(added.length ? `Added ${documentsLabel(added.length)}.` : "Those files were already here.", added.length ? "success" : "info");
      if (added.length) window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "imported" } }));
      load();
    } catch {
      showToast("Those files couldn't be added.", "warning");
    } finally {
      setIsAdding(false);
    }
  };

  const chooseFiles = async () => {
    if (isAdding) return;
    try {
      const paths = await invoke<string[] | null>("select_import_files");
      if (paths?.length) await addFiles(paths);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const togglePin = async (doc: DocumentItem) => {
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, is_pinned: !d.is_pinned } : d)));
    try {
      const res = await apiFetch(`/api/documents/${doc.id}/pin`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "pinned", photoId: doc.id, is_pinned: data.is_pinned } }));
    } catch {
      load();
    }
  };

  const changeCategory = async (doc: DocumentItem, next: string) => {
    setMenuFor(null);
    try {
      const res = await apiFetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, category: next } : d)));
      showToast(`Moved to ${categoryLabel(next)}.`, "success");
    } catch {
      showToast("The category couldn't be changed.", "warning");
    }
  };

  const moveToTrash = async (doc: DocumentItem) => {
    setMenuFor(null);
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    try {
      const res = await apiFetch(`/api/photos/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Moved to Trash. You can restore it for 30 days.", "info");
      window.dispatchEvent(new CustomEvent("photos-changed", { detail: { action: "deleted", photoId: doc.id } }));
    } catch {
      showToast("That document couldn't be moved to Trash.", "warning");
      load();
    }
  };

  const card = (doc: DocumentItem) => (
    <div key={doc.id} className="doc-card">
      <button
        type="button"
        className="doc-open"
        aria-label={`Open ${doc.title}`}
        onClick={() => onDocumentClick?.(viewerOrder.findIndex((d) => d.id === doc.id), viewerOrder)}
      >
        <span className="doc-paper">
          <img src={getThumbnailUrl(doc.id)} alt="" loading="lazy" draggable={false} />
        </span>
        <span className="doc-text">
          <span className="doc-title">{doc.title}</span>
          <span className="doc-meta">
            {categoryLabel(doc.category)} · {shortDate(doc.date)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className={`doc-pin${doc.is_pinned ? " is-on" : ""}`}
        aria-label={doc.is_pinned ? `Unpin ${doc.title}` : `Pin ${doc.title}`}
        aria-pressed={Boolean(doc.is_pinned)}
        title={doc.is_pinned ? "Unpin" : "Pin to the top"}
        onClick={() => togglePin(doc)}
      >
        <Pin size={13} fill={doc.is_pinned ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        className="doc-more"
        aria-label={`More for ${doc.title}`}
        aria-haspopup="menu"
        aria-expanded={menuFor === doc.id}
        onClick={() => setMenuFor(menuFor === doc.id ? null : doc.id)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuFor === doc.id && (
        <>
          <div className="doc-menu-backdrop" onClick={() => setMenuFor(null)} />
          <div className="doc-menu" role="menu" aria-label={`Actions for ${doc.title}`}>
            <span className="doc-menu-label">Category</span>
            {DOCUMENT_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={doc.category === c.id}
                className={doc.category === c.id ? "is-current" : ""}
                onClick={() => changeCategory(doc, c.id)}
              >
                {c.label}
              </button>
            ))}
            <div className="doc-menu-divider" />
            <button type="button" role="menuitem" className="is-danger" onClick={() => moveToTrash(doc)}>
              Move to Trash
            </button>
          </div>
        </>
      )}
    </div>
  );

  const currentLabel = category === "all" ? "All documents" : categoryLabel(category);
  return (
    <div className="docs-page">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const paths = Array.from(e.target.files ?? [])
            .map((f) => (f as File & { path?: string }).path)
            .filter((p): p is string => Boolean(p));
          if (paths.length) addFiles(paths);
          e.target.value = "";
        }}
      />
      <div className="docs-header">
        <h1 className="docs-title">Documents</h1>
        <span className="docs-subtitle">{documentsLabel(docs.length)}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="docs-icon-btn" aria-label="Search documents" title="Search (Ctrl+K)" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
        </button>
        <button type="button" className="docs-btn" onClick={findInPhotos} disabled={isScanning}>
          {isScanning ? <Loader2 size={14} className="spin" /> : <ScanSearch size={14} />}
          {isScanning ? "Looking…" : "Find in photos"}
        </button>
        <button type="button" className="docs-btn docs-btn-primary" onClick={chooseFiles} disabled={isAdding}>
          {isAdding ? <Loader2 size={14} className="spin" /> : <Plus size={15} strokeWidth={2.5} />}
          Add
        </button>
      </div>

      <div className="docs-chips" role="radiogroup" aria-label="Category">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={category === chip.id}
            className={`docs-chip${category === chip.id ? " is-on" : ""}`}
            onClick={() => setCategory(chip.id)}
          >
            {chip.label} <span className="docs-chip-count">{chip.count.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {isLoading ? null : docs.length === 0 ? (
        <div className="docs-empty">
          <h2>{searchQuery.trim() ? `No documents match "${searchQuery.trim()}"` : "No documents yet"}</h2>
          <p>Add receipts, IDs and other papers, or let the app find the ones already in your photos.</p>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="docs-section" aria-labelledby="docs-pinned">
              <h2 id="docs-pinned" className="docs-section-title">Pinned</h2>
              <div className="docs-grid">{pinned.map(card)}</div>
            </section>
          )}
          <section className="docs-section" aria-labelledby="docs-rest">
            <h2 id="docs-rest" className="docs-section-title">{currentLabel}</h2>
            {rest.length ? <div className="docs-grid">{rest.map(card)}</div> : <p className="docs-none">Nothing else here.</p>}
          </section>
        </>
      )}
    </div>
  );
};
