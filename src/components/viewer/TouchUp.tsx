/**
 * Remove scratches and spots (H10 / A7), as on the A1 board:
 * - LimeMarks: what was repaired, in lime, over the before/after view ("Show marks").
 * - TouchUpEditor: optional, on the scratch-free result. Lime = what was removed; the brush
 *   paints a missed scratch, the eraser brings a detail back. Apply repairs again with exactly
 *   these marks. Faces under a mark are left alone unless you paint them.
 *
 * The marks come from the engine as a black/white PNG (white = repair, long side <= 1024 px)
 * and go back the same way. They are fetched with the app's token (never as a plain <img>),
 * so the canvas can read them.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Brush, Eraser, Loader2, Undo2 } from "lucide-react";
import { apiFetch } from "../../services/api";

const LIME: [number, number, number] = [198, 255, 0];

/** The marks PNG as a canvas where repaired pixels are white and the rest transparent. */
export function useMarks(maskUrl: string | null): HTMLCanvasElement | null {
  const [marks, setMarks] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    setMarks(null);
    if (!maskUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(maskUrl);
        if (!res.ok) return;
        const bitmap = await createImageBitmap(await res.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const on = data.data[i] > 127;
          data.data[i] = data.data[i + 1] = data.data[i + 2] = 255;
          data.data[i + 3] = on ? 255 : 0;
        }
        ctx.putImageData(data, 0, 0);
        if (!cancelled) setMarks(canvas);
      } catch {
        /* No marks to show: the view works without them. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [maskUrl]);
  return marks;
}

/** Draws ``marks`` (white on transparent) onto ``target`` in lime. */
function paintLime(target: HTMLCanvasElement | null, marks: HTMLCanvasElement | null, alpha = 0.85) {
  const ctx = target?.getContext("2d");
  if (!target || !ctx || !marks) return;
  if (target.width !== marks.width || target.height !== marks.height) {
    target.width = marks.width;
    target.height = marks.height;
  }
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(marks, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = `rgba(${LIME.join(",")},${alpha})`;
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.globalCompositeOperation = "source-over";
}

/** The marks in lime over the before/after frame (no pointer events). */
export const LimeMarks: React.FC<{ marks: HTMLCanvasElement | null }> = ({ marks }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => paintLime(ref.current, marks), [marks]);
  if (!marks) return null;
  return <canvas ref={ref} className="ba-marks" aria-label="Repaired marks" role="img" />;
};

type Tool = "brush" | "eraser";
const MAX_UNDO = 20;

export const TouchUpEditor: React.FC<{
  resultUrl: string;
  marks: HTMLCanvasElement | null;
  busy: boolean;
  onApply: (maskPng: Blob) => void;
  onCancel: () => void;
}> = ({ resultUrl, marks, busy, onApply, onCancel }) => {
  const [tool, setTool] = useState<Tool>("brush");
  const [size, setSize] = useState(14);
  const [hidden, setHidden] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [ready, setReady] = useState(false); // The sheet to paint on exists (a ref alone wouldn't re-render).
  const editRef = useRef<HTMLCanvasElement | null>(null); // White = repair, transparent = keep.
  const viewRef = useRef<HTMLCanvasElement>(null);
  const undo = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Start from the app's marks (or an empty sheet of the right size once the photo loads).
  const ensureSheet = useCallback((width: number, height: number) => {
    if (editRef.current) return;
    const sheet = document.createElement("canvas");
    sheet.width = marks?.width ?? width;
    sheet.height = marks?.height ?? height;
    if (marks) sheet.getContext("2d")?.drawImage(marks, 0, 0);
    editRef.current = sheet;
    paintLime(viewRef.current, sheet, 0.7);
    setReady(true);
  }, [marks]);

  useEffect(() => {
    if (marks) ensureSheet(marks.width, marks.height);
  }, [marks, ensureSheet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const redraw = () => paintLime(viewRef.current, editRef.current, 0.7);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const sheet = editRef.current;
    if (!sheet || !box.width) return null;
    return { x: ((e.clientX - box.left) / box.width) * sheet.width, y: ((e.clientY - box.top) / box.height) * sheet.height, scale: sheet.width / box.width };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, scale: number) => {
    const ctx = editRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === "brush" ? "source-over" : "destination-out";
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, size * scale);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    redraw();
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    const ctx = editRef.current?.getContext("2d");
    if (!p || !ctx || !editRef.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    undo.current.push(ctx.getImageData(0, 0, editRef.current.width, editRef.current.height));
    if (undo.current.length > MAX_UNDO) undo.current.shift();
    setUndoCount(undo.current.length);
    last.current = p;
    stroke(p, p, p.scale);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = point(e);
    if (!p) return;
    stroke(last.current, p, p.scale);
    last.current = p;
  };

  const doUndo = () => {
    const ctx = editRef.current?.getContext("2d");
    const prev = undo.current.pop();
    if (!ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setUndoCount(undo.current.length);
    redraw();
  };

  const apply = () => {
    const sheet = editRef.current;
    if (!sheet) return;
    const out = document.createElement("canvas");
    out.width = sheet.width;
    out.height = sheet.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(sheet, 0, 0);
    out.toBlob((blob) => blob && onApply(blob), "image/png");
  };

  return (
    <div className="op-touchup" role="dialog" aria-modal="true" aria-label="Touch up" data-theme="dark">
      <header className="op-touchup-head">
        <button type="button" className="viewer-icon-btn" aria-label="Back" onClick={onCancel} disabled={busy}>
          <ArrowLeft size={17} />
        </button>
        <div className="op-touchup-title">
          <strong>Touch up</strong>
          <small>Lime = what was removed · paint a missed scratch, or erase to bring a detail back</small>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="dash-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="dash-btn dash-btn-primary" onClick={apply} disabled={busy || !ready}>
          {busy && <Loader2 size={13} className="spin" />}
          Apply
        </button>
      </header>
      <div className="op-touchup-stage">
        <div className="op-touchup-frame">
          <img
            src={resultUrl}
            alt="The repaired photo"
            className="op-touchup-img"
            draggable={false}
            onLoad={(e) => ensureSheet(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
          <canvas
            ref={viewRef}
            className={`op-touchup-canvas${hidden ? " is-hidden" : ""}`}
            aria-label="Marks to repair"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (last.current = null)}
            onPointerLeave={() => (last.current = null)}
          />
        </div>
      </div>
      <footer className="op-touchup-tools">
        <div className="viewer-segment" role="group" aria-label="Tool">
          <button type="button" aria-pressed={tool === "brush"} className={tool === "brush" ? "is-on" : ""} onClick={() => setTool("brush")}>
            <Brush size={14} /> Brush
          </button>
          <button type="button" aria-pressed={tool === "eraser"} className={tool === "eraser" ? "is-on" : ""} onClick={() => setTool("eraser")}>
            <Eraser size={14} /> Eraser
          </button>
        </div>
        <label className="op-touchup-size">
          Size
          <input type="range" min={4} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size" />
        </label>
        <button type="button" className="dash-btn" aria-pressed={hidden} onClick={() => setHidden((v) => !v)}>
          {hidden ? "Show marks" : "Hide marks"}
        </button>
        <button type="button" className="dash-btn" onClick={doUndo} disabled={!undoCount}>
          <Undo2 size={14} /> Undo
        </button>
        <span className="op-touchup-note">Faces under a mark are left alone unless you paint them.</span>
      </footer>
    </div>
  );
};
