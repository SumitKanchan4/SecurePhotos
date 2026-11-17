/**
 * The viewer's old-photo pieces (H10 / A3), as approved on the A1 board:
 * - ImproveMenu: the "…" button with only the improvements that fit this photo.
 * - VersionSwitch: "Original / Improved" when the photo has a linked copy.
 * - BeforeAfter: the result over the photo with a draggable divider (strength = opacity), and
 *   for faces (A5) an outline on each face: click one to keep it as it was.
 * - OldPhotoPanel: Natural / Vivid, strength, Keep this…, plus progress, model download and errors.
 * - KeepDialog: Keep both / Replace the photo / Discard, with "Remember my choice".
 * - ModelDialog (A2c): an action whose model isn't on this computer yet asks to download it
 *   (progress, cancel, keep browsing) and then starts. "Not now" keeps only that action locked.
 */
import React, { useEffect, useRef, useState } from "react";
import { Download, Loader2, Lock, MoreHorizontal, Palette, ScanFace, SunMedium, X } from "lucide-react";
import { apiFetch } from "../../services/api";
import { IMPROVE_LABELS, type ImproveKind, type KeepChoice, type ModelPrompt, type OldPhotoState, type ResultFace } from "./useOldPhoto";

const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

export const ImproveMenu: React.FC<{ old: OldPhotoState }> = ({ old }) => {
  const [open, setOpen] = useState(false);
  const items = [
    old.options?.colour && { kind: "colour" as const, icon: <Palette size={15} />, hint: "Natural colours for a black-and-white photo" },
    old.options?.fade && { kind: "fade" as const, icon: <SunMedium size={15} />, hint: "Removes a yellow cast and brings colours back" },
    old.options?.faces && { kind: "faces" as const, icon: <ScanFace size={15} />, hint: "Clearer faces in blurry or old photos" },
  ].filter(Boolean) as { kind: ImproveKind; icon: React.ReactNode; hint: string }[];
  if (!items.length) return null;
  return (
    <div className="viewer-menu-anchor">
      <button
        type="button"
        className={`viewer-icon-btn${open ? " is-on" : ""}`}
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <>
          <div className="viewer-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="viewer-menu" role="menu" aria-label="More">
            {items.map((item) => {
              const bytes = old.downloads[item.kind];
              return (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  className={bytes ? "is-locked" : undefined}
                  disabled={old.busy || old.panelOpen}
                  onClick={() => {
                    setOpen(false);
                    void old.start(item.kind);
                  }}
                >
                  {item.icon}
                  <span>
                    <strong>{IMPROVE_LABELS[item.kind].action}</strong>
                    <small>{bytes ? `Needs a one-time download · ${formatGb(bytes)}` : item.hint}</small>
                  </span>
                  {bytes ? <Lock size={13} className="viewer-menu-lock" aria-label="Needs a download" /> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export const VersionSwitch: React.FC<{
  old: OldPhotoState;
  currentId: number;
  onOpen: (photoId: number) => boolean;
}> = ({ old, currentId, onOpen }) => {
  const live = old.versions.filter((m) => !m.trashed);
  if (live.length < 2) return null;
  const original = live.find((m) => m.is_original);
  const improved = [...live].reverse().find((m) => !m.is_original);
  if (!original || !improved) return null;
  const onOriginal = currentId === original.id;
  return (
    <div className="viewer-segment" role="group" aria-label="Version">
      <button type="button" aria-pressed={onOriginal} className={onOriginal ? "is-on" : ""} onClick={() => !onOriginal && onOpen(original.id)}>
        Original
      </button>
      <button type="button" aria-pressed={!onOriginal} className={!onOriginal ? "is-on" : ""} onClick={() => onOriginal && onOpen(improved.id)}>
        Improved
      </button>
    </div>
  );
};

export const BeforeAfter: React.FC<{
  before: string;
  after: string;
  intensity: number;
  faces?: ResultFace[];
  facesOff?: number[];
  onToggleFace?: (index: number) => void;
}> = ({ before, after, intensity, faces = [], facesOff = [], onToggleFace }) => {
  const [split, setSplit] = useState(50);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box) setSplit(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)));
  };
  return (
    <div
      className="ba-stage"
      ref={boxRef}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      <div className="ba-frame">
        <img src={before} alt="Before" className="ba-img" draggable={false} />
        <img
          src={after}
          alt="After"
          className="ba-img ba-after"
          draggable={false}
          style={{ opacity: intensity, clipPath: `inset(0 0 0 ${split}%)` }}
        />
        <span className="ba-tag ba-tag-before">Before</span>
        <span className="ba-tag ba-tag-after">AI · After</span>
        {faces.map((face, i) => {
          const [x, y, w, h] = face.box;
          const on = face.sharpened && !facesOff.includes(i);
          const style = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
          if (!face.sharpened) {
            return (
              <span key={i} className="ba-face is-kept" style={style} title="Left as it was: it no longer looked like the same person" aria-hidden="true" />
            );
          }
          return (
            <button
              key={i}
              type="button"
              className={`ba-face${on ? " is-on" : ""}`}
              style={style}
              aria-pressed={on}
              aria-label={`Face ${i + 1}: ${on ? "sharpened" : "as it was"}`}
              title={on ? "Sharpened · click to keep this face as it was" : "As it was · click to sharpen it"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onToggleFace?.(i)}
            />
          );
        })}
        <div className="ba-divider" style={{ left: `${split}%` }}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(split)}
            aria-label="Compare before and after"
            onChange={(e) => setSplit(Number(e.target.value))}
            className="ba-range"
          />
          <span className="ba-handle" aria-hidden="true">⇆</span>
        </div>
      </div>
    </div>
  );
};

export const OldPhotoPanel: React.FC<{
  old: OldPhotoState;
  onKept: (choice: KeepChoice, newPhotoId: number | null) => void;
  onError: (message: string) => void;
}> = ({ old, onKept, onError }) => {
  const job = old.job;
  const [asking, setAsking] = useState(false);
  const [remembered, setRemembered] = useState<"ask" | "keep_both" | "replace">("ask");
  useEffect(() => {
    apiFetch("/api/system/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setRemembered(data.settings?.old_photos_keep_choice ?? "ask"))
      .catch(() => undefined);
  }, [job?.id]);
  if (!job) return null;
  const label = IMPROVE_LABELS[job.kind];

  const decide = async (choice: KeepChoice, remember = false) => {
    try {
      const newId = await old.keep(choice, remember);
      setAsking(false);
      onKept(choice, newId);
    } catch (err) {
      onError(err instanceof Error && err.message === "vault_locked" ? "Unlock the vault to keep this photo." : "Couldn't save the result. Please try again.");
    }
  };

  return (
    <aside className="op-panel" aria-label={label.action}>
      <div className="op-head">
        <strong>{label.action}</strong>
        <button type="button" className="op-close" aria-label="Close" onClick={() => (job.status === "review" ? void decide("discard") : void old.cancel())}>
          <X size={15} />
        </button>
      </div>

      {(job.status === "queued" || job.status === "working") && (
        <div className="op-section">
          <p className="op-text">{job.status === "queued" ? "Waiting for the photo before it…" : `${label.working}…`}</p>
          <div className="op-bar"><div style={{ width: `${job.progress}%` }} /></div>
          <p className="op-hint">This runs on your computer. You can keep looking at other photos.</p>
          <button type="button" className="op-btn" onClick={() => void old.cancel()}>Cancel</button>
        </div>
      )}

      {old.needsModels && (
        <div className="op-section">
          <p className="op-text">This needs a one-time download first. After that it works offline.</p>
          <button type="button" className="op-btn op-btn-primary" onClick={() => job.kind !== "scratches" && old.askForModels(job.kind)}>
            <Download size={14} /> Download…
          </button>
        </div>
      )}

      {job.status === "failed" && !old.needsModels && (
        <div className="op-section">
          <p className="op-text">This photo couldn't be improved.</p>
          <button type="button" className="op-btn" onClick={old.dismiss}>Close</button>
        </div>
      )}

      {job.status === "review" && (
        <>
          {job.kind === "colour" && (
            <div className="op-section">
              <span className="op-label">Colour</span>
              <div className="viewer-segment op-segment" role="group" aria-label="Colour style">
                {(["natural", "vivid"] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={old.style === s} className={old.style === s ? "is-on" : ""} disabled={old.busy || old.style === s} onClick={() => void old.start("colour", s)}>
                    {s === "natural" ? "Natural" : "Vivid"}
                  </button>
                ))}
              </div>
              <p className="op-hint">Vivid gives richer colour to faded group photos; it can get a few colours wrong.</p>
            </div>
          )}
          <FacesSection old={old} />
          <div className="op-section">
            <label className="op-label" htmlFor="op-strength">Strength</label>
            <input id="op-strength" type="range" min={0} max={100} value={Math.round(old.intensity * 100)} onChange={(e) => old.setIntensity(Number(e.target.value) / 100)} className="op-range" />
          </div>
          <div className="op-foot">
            <p className="op-hint">Made by AI on this computer. Copies you export are labelled as AI-edited.</p>
            <button
              type="button"
              className="op-btn op-btn-primary"
              disabled={old.busy}
              onClick={() => (remembered === "ask" ? setAsking(true) : void decide(remembered))}
            >
              {old.busy && <Loader2 size={13} className="spin" />}
              {remembered === "replace" ? "Replace the photo" : remembered === "keep_both" ? "Keep both" : "Keep this…"}
            </button>
          </div>
        </>
      )}

      {asking && <KeepDialog busy={old.busy} onDecide={decide} onCancel={() => setAsking(false)} />}
    </aside>
  );
};

export const KeepDialog: React.FC<{
  busy: boolean;
  onDecide: (choice: KeepChoice, remember: boolean) => void;
  onCancel: () => void;
}> = ({ busy, onDecide, onCancel }) => {
  const [choice, setChoice] = useState<"keep_both" | "replace">("keep_both");
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div className="alb-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="alb-dialog op-dialog" role="dialog" aria-modal="true" aria-labelledby="op-keep-title">
        <div className="alb-dialog-head">
          <h2 id="op-keep-title">Keep the improved photo?</h2>
        </div>
        <div className="op-dialog-body" role="radiogroup" aria-label="How to keep it">
          <label className={`op-choice${choice === "keep_both" ? " is-on" : ""}`}>
            <input type="radio" name="op-keep" checked={choice === "keep_both"} onChange={() => setChoice("keep_both")} />
            <span><strong>Keep both</strong><small>The improved photo sits next to the original in Photos.</small></span>
          </label>
          <label className={`op-choice${choice === "replace" ? " is-on" : ""}`}>
            <input type="radio" name="op-keep" checked={choice === "replace"} onChange={() => setChoice("replace")} />
            <span><strong>Replace the photo</strong><small>The original goes to Trash. You can restore it for 30 days.</small></span>
          </label>
          <label className="op-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember my choice
          </label>
        </div>
        <div className="alb-dialog-foot">
          <button type="button" className="dash-btn" disabled={busy} onClick={() => onDecide("discard", false)}>Discard</button>
          <button type="button" className="dash-btn dash-btn-primary" disabled={busy} onClick={() => onDecide(choice, remember)} autoFocus>
            {busy && <Loader2 size={13} className="spin" />}
            {choice === "keep_both" ? "Keep both" : "Replace the photo"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** What each action needs to download, in plain words (no model names). */
const MODEL_REASON: Record<string, string> = {
  colour: "the colour model",
  fade: "its model",
  faces: "the face model",
  scratches: "its model",
};

/**
 * A2c popup: "Add colour needs a one-time download". Download shows progress here (and in
 * Activity) and then starts the action; "Keep browsing" closes the popup while it carries on;
 * "Not now" leaves only this action locked.
 */
export const ModelDialog: React.FC<{
  prompt: ModelPrompt;
  progress: { done: number; total: number } | null;
  onDownload: () => void;
  onCancelDownload: () => void;
  onClose: () => void;
}> = ({ prompt, progress, onDownload, onCancelDownload, onClose }) => {
  const label = IMPROVE_LABELS[prompt.kind];
  const downloading = prompt.phase === "downloading";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pct = progress && progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  const size = prompt.bytes ? ` (${formatGb(prompt.bytes)})` : "";
  return (
    <div className="alb-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="alb-dialog op-dialog" role="dialog" aria-modal="true" aria-labelledby="op-model-title">
        <div className="alb-dialog-head">
          <h2 id="op-model-title">{label.action} needs a one-time download</h2>
        </div>
        <div className="op-dialog-body">
          {prompt.phase === "failed" ? (
            <p className="op-text" role="alert">Couldn't download it. Check your internet connection and try again.</p>
          ) : (
            <p className="op-text">
              SecurePhotos does this on your computer, so it needs {MODEL_REASON[prompt.kind] ?? "its model"} first{size}. After that it works
              offline, and your photos never leave this computer.
            </p>
          )}
          {downloading && (
            <>
              <div className="op-bar" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <p className="op-hint">
                {progress && progress.total > 1 ? `${formatGb(progress.done)} of ${formatGb(progress.total)} · ` : ""}
                You can keep browsing; the download carries on in Activity.
              </p>
            </>
          )}
          {!downloading && <p className="op-hint">Until then, everything else in SecurePhotos works as usual.</p>}
        </div>
        <div className="alb-dialog-foot">
          {downloading ? (
            <>
              <button type="button" className="dash-btn" onClick={onCancelDownload}>Cancel download</button>
              <button type="button" className="dash-btn dash-btn-primary" onClick={onClose} autoFocus>Keep browsing</button>
            </>
          ) : (
            <>
              <button type="button" className="dash-btn" onClick={onClose}>Not now</button>
              <button type="button" className="dash-btn dash-btn-primary" onClick={onDownload} autoFocus>
                <Download size={14} /> {prompt.phase === "failed" ? "Try again" : "Download"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** What happened to the faces in a result (A5), and the way to sharpen them when the model is missing. */
const FacesSection: React.FC<{ old: OldPhotoState }> = ({ old }) => {
  const job = old.job;
  if (!job) return null;
  const faces = job.faces ?? [];
  const waiting = job.faces_waiting ?? 0;
  if (waiting > 0) {
    return (
      <div className="op-section">
        <span className="op-label">Faces</span>
        <p className="op-text">{waiting === 1 ? "There is a face" : `There are ${waiting} faces`} that could be sharpened too.</p>
        <button type="button" className="op-btn" onClick={() => old.askForModels("faces", job.kind === "scratches" ? "faces" : job.kind)}>
          <ScanFace size={14} /> Also sharpen faces
        </button>
      </div>
    );
  }
  if (!faces.length) return null;
  const sharpened = faces.filter((f, i) => f.sharpened && !old.facesOff.includes(i)).length;
  const asItWas = faces.filter((f, i) => f.sharpened && old.facesOff.includes(i)).length;
  const kept = faces.filter((f) => !f.sharpened).length;
  const parts = [
    `${sharpened} ${sharpened === 1 ? "face" : "faces"} sharpened`,
    asItWas ? `${asItWas} switched off` : null,
    kept ? `${kept} left as ${kept === 1 ? "it was" : "they were"} (no longer looked like the same person)` : null,
  ].filter(Boolean);
  return (
    <div className="op-section">
      <span className="op-label">Faces</span>
      <p className="op-text">{parts.join(" · ")}.</p>
      {faces.some((f) => f.sharpened) && <p className="op-hint">Click a face on the photo to keep it as it was.</p>}
    </div>
  );
};
