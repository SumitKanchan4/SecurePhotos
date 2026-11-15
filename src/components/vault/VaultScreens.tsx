/**
 * The vault screens the R4 redesign didn't cover (R11, approved "Private Vault · setup, shield,
 * albums, documents" board): first-time setup, the privacy shield, the locked-album page and
 * cover grid, and vault documents as paper cards. Plain words; moving something back to the
 * library always asks first.
 */
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, EyeOff, Loader2, Lock, MoreHorizontal, Play } from "lucide-react";
import type { PhotoItem, VaultAlbumItem } from "../../types";
import { getApiUrl } from "../../services/api";
import { fromPhotoItem } from "../../utils/photoTimeline";
import { PhotoTimeline } from "../photos/PhotoTimeline";
import { AlbumSlideshowModal } from "../AlbumSlideshowModal";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { storySpan } from "../stories/storiesFormat";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const vaultThumb = (id: number) => getApiUrl(`/api/vault/thumbnail/${id}`);

/** "12 photos · 2019 – 2024" for a locked album. */
export function vaultAlbumMeta(photos: Pick<PhotoItem, "taken_at">[]): string {
  const dates = photos.map((p) => p.taken_at).filter((d): d is string => Boolean(d)).sort();
  const span = dates.length ? storySpan(dates[0], dates[dates.length - 1]) : "";
  return [plural(photos.length, "photo"), span].filter(Boolean).join(" · ");
}

/** "IDs · 3 Mar 2024" under a vault document. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function vaultDocMeta(doc: Pick<PhotoItem, "taken_at">): string {
  const raw = doc.taken_at || "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "No date";
}

// ── 1. Not set up yet ────────────────────────────────────────────────────────
export const VaultIntro: React.FC<{ onSetUp: () => void }> = ({ onSetUp }) => (
  <div className="vault-intro">
    <div className="vault-intro-emblem" aria-hidden="true">
      <Lock size={28} strokeWidth={2.2} />
    </div>
    <h2>Keep private photos here</h2>
    <p>
      Photos, videos and papers you move to the vault are locked on this computer. They open only with your password or PIN, and they never
      show in Photos, Search or People.
    </p>
    <ol className="vault-intro-steps">
      <li>Choose a password</li>
      <li>Add a 4-digit PIN</li>
      <li>Print your Emergency Card</li>
    </ol>
    <button type="button" className="dash-btn dash-btn-primary" onClick={onSetUp}>
      Set up the vault
    </button>
  </div>
);

// ── 2. Privacy shield ────────────────────────────────────────────────────────
export const VaultShield: React.FC<{ onShow: () => void }> = ({ onShow }) => (
  <div className="vault-shield" role="status">
    <div className="vault-shield-icon" aria-hidden="true">
      <EyeOff size={24} />
    </div>
    <h2>Hidden while you look away</h2>
    <p>The vault stays open behind this. Press P or the button to show it again.</p>
    <button type="button" className="dash-btn dash-btn-primary" onClick={onShow}>
      Show photos
    </button>
  </div>
);

// ── 3a. Locked albums as covers ─────────────────────────────────────────────
export const VaultAlbumsGrid: React.FC<{ albums: VaultAlbumItem[]; loading: boolean; onOpen: (album: VaultAlbumItem) => void }> = ({
  albums,
  loading,
  onOpen,
}) => {
  if (loading) {
    return (
      <div className="dash-empty">
        <Loader2 size={22} className="spin" />
      </div>
    );
  }
  if (!albums.length) {
    return (
      <div className="dash-empty">
        <Lock size={26} aria-hidden="true" />
        <h2>No albums in the vault</h2>
        <p>Open an album in Albums and choose "Move album to Vault" from its "…" menu.</p>
      </div>
    );
  }
  return (
    <div className="alb-covers vault-albums">
      {albums.map((album) => (
        <button key={album.id} type="button" className="alb-cover-card" onClick={() => onOpen(album)}>
          <span className="alb-cover vault-album-cover">
            {album.cover_photo_id ? <img src={vaultThumb(album.cover_photo_id)} alt="" loading="lazy" draggable={false} /> : null}
            <span className="vault-lock-chip" aria-hidden="true">
              <Lock size={11} strokeWidth={2.6} /> In vault
            </span>
          </span>
          <span className="alb-cover-name">{album.name}</span>
          <span className="dash-muted">{plural(album.photo_count ?? 0, "photo")}</span>
        </button>
      ))}
    </div>
  );
};

/** Closes a "…" menu on a click outside it or Escape. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ── 3b. One locked album ─────────────────────────────────────────────────────
interface VaultAlbumPageProps {
  album: VaultAlbumItem;
  photos: PhotoItem[];
  loading: boolean;
  moving: boolean;
  onBack: () => void;
  onOpenPhoto: (index: number) => void;
  onMoveOut: () => void;
}

export const VaultAlbumPage: React.FC<VaultAlbumPageProps> = ({ album, photos, loading, moving, onBack, onOpenPhoto, onMoveOut }) => {
  const menu = useMenu();
  const [confirm, setConfirm] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const timeline = photos.map(fromPhotoItem);
  return (
    <div className="alb-page vault-album-page">
      <div>
        <button type="button" className="dash-back" onClick={onBack}>
          <ArrowLeft size={15} /> Albums
        </button>
      </div>
      <div className="dash-header alb-header">
        <h1 className="dash-title">{album.name}</h1>
        <span className="vault-lock-chip">
          <Lock size={11} strokeWidth={2.6} /> In vault
        </span>
        {!loading && <span className="dash-subtitle">{vaultAlbumMeta(photos)}</span>}
        <div style={{ flex: 1 }} />
        {photos.length > 0 && (
          <button type="button" className="dash-btn" onClick={() => setSlideshow(true)}>
            <Play size={13} fill="currentColor" /> Slideshow
          </button>
        )}
        <div className="alb-menu-wrap" ref={menu.ref}>
          <button type="button" className="dash-icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menu.open} onClick={() => menu.setOpen((v) => !v)}>
            <MoreHorizontal size={16} />
          </button>
          {menu.open && (
            <div className="alb-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  menu.setOpen(false);
                  setConfirm(true);
                }}
              >
                Move album back to library…
              </button>
            </div>
          )}
        </div>
      </div>
      {loading ? (
        <div className="dash-empty">
          <Loader2 size={22} className="spin" />
        </div>
      ) : (
        <div className="alb-grid">
          <PhotoTimeline
            photos={timeline}
            onOpen={onOpenPhoto}
            vault
            minScrubberSections={4}
            empty={
              <div className="dash-empty">
                <h2>This album is empty</h2>
                <p>Photos moved out of the vault one by one have left it.</p>
              </div>
            }
          />
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Move ${album.name} back to your library?`}
          message={`Its ${plural(album.photo_count ?? photos.length, "photo")} will show in Photos and Albums again, and anyone using this computer can see them.`}
          confirmLabel="Move back to library"
          busy={moving}
          onConfirm={() => {
            onMoveOut();
            setConfirm(false);
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
      <AlbumSlideshowModal isOpen={slideshow} albumName={album.name} photos={photos} onClose={() => setSlideshow(false)} />
    </div>
  );
};

// ── 4. Vault documents as paper cards ────────────────────────────────────────
interface VaultDocumentsProps {
  docs: PhotoItem[];
  loading: boolean;
  movingId: number | null;
  onOpen: (index: number) => void;
  onMoveOut: (doc: PhotoItem) => void;
}

const DocCard: React.FC<{ doc: PhotoItem; index: number; moving: boolean; onOpen: (i: number) => void; onAskMoveOut: (doc: PhotoItem) => void }> = ({
  doc,
  index,
  moving,
  onOpen,
  onAskMoveOut,
}) => {
  const menu = useMenu();
  const title = (doc.filename || "Document").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return (
    <div className="doc-card vault-doc">
      <button type="button" className="doc-paper" onClick={() => onOpen(index)} aria-label={`Open ${title}`}>
        {doc.id ? <img src={vaultThumb(doc.id)} alt="" loading="lazy" draggable={false} /> : null}
        <span className="vault-doc-lock" aria-hidden="true">
          <Lock size={11} strokeWidth={2.6} />
        </span>
      </button>
      <div className="vault-doc-foot">
        <div className="vault-doc-text">
          <span className="alb-cover-name">{title}</span>
          <span className="dash-muted">{vaultDocMeta(doc)}</span>
        </div>
        <div className="alb-menu-wrap" ref={menu.ref}>
          <button
            type="button"
            className="dash-icon-btn"
            aria-label={`More for ${title}`}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            disabled={moving}
            onClick={() => menu.setOpen((v) => !v)}
          >
            {moving ? <Loader2 size={14} className="spin" /> : <MoreHorizontal size={16} />}
          </button>
          {menu.open && (
            <div className="alb-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  menu.setOpen(false);
                  onOpen(index);
                }}
              >
                Open
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  menu.setOpen(false);
                  onAskMoveOut(doc);
                }}
              >
                Move back to library…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const VaultDocuments: React.FC<VaultDocumentsProps> = ({ docs, loading, movingId, onOpen, onMoveOut }) => {
  const [asking, setAsking] = useState<PhotoItem | null>(null);
  if (loading) {
    return (
      <div className="dash-empty">
        <Loader2 size={22} className="spin" />
      </div>
    );
  }
  if (!docs.length) {
    return (
      <div className="dash-empty">
        <Lock size={26} aria-hidden="true" />
        <h2>No documents in the vault</h2>
        <p>Open a document and press the lock to move it here.</p>
      </div>
    );
  }
  return (
    <>
      <div className="docs-grid vault-docs">
        {docs.map((doc, i) => (
          <DocCard key={doc.id} doc={doc} index={i} moving={movingId === doc.id} onOpen={onOpen} onAskMoveOut={setAsking} />
        ))}
      </div>
      {asking && (
        <ConfirmDialog
          title="Move this document back to your library?"
          message="It will show in Documents and Search again, and anyone using this computer can see it."
          confirmLabel="Move back to library"
          onConfirm={() => {
            onMoveOut(asking);
            setAsking(null);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </>
  );
};
