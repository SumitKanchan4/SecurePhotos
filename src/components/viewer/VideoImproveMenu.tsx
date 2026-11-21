/**
 * "…" in the viewer for a video (T29, owner 2026-11-21): make it Full HD, 2K or 4K, offering
 * only sizes above its current one, so a video can be improved again after it was processed.
 * Videos are resized, not AI-enlarged, on a computer without a graphics card: sharper on a big
 * screen and a bigger file, but no new detail. The wording says so.
 */
import React, { useState } from "react";
import { Loader2, MoreHorizontal, Sparkles } from "lucide-react";
import { videoImproveOptions } from "./viewerFormat";

export const VideoImproveMenu: React.FC<{
  width?: number | null;
  height?: number | null;
  busy: boolean;
  onImprove: (target: number) => void;
}> = ({ width, height, busy, onImprove }) => {
  const [open, setOpen] = useState(false);
  const options = videoImproveOptions(width, height);
  if (!options.length) return null;
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
        {busy ? <Loader2 size={17} className="spin" /> : <MoreHorizontal size={17} />}
      </button>
      {open && (
        <>
          <div className="viewer-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="viewer-menu" role="menu" aria-label="More">
            {options.map((option) => (
              <button
                key={option.target}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onImprove(option.target);
                }}
              >
                <Sparkles size={15} />
                <span>
                  <strong>Make it {option.label}</strong>
                  <small>Sharper on a big screen; a bigger file. Takes a few minutes.</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
