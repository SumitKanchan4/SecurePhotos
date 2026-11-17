/**
 * Activity (H10 / A4, board approved 2026-11-16): one page for everything the app is working on
 * in the background. Working now (progress, Cancel), Waiting, Ready to look at (results waiting
 * for Keep both / Replace / Discard), Finished today. Vault photos show a locked, blurred tile
 * and no file name. Reached from the rail's status ring and the Photos header pill.
 */
import React from "react";
import { CloudDownload, Film, FolderInput, Lock, Pause, Play, Sparkles } from "lucide-react";
import { getThumbnailUrl } from "../../services/api";
import type { ActivityItem, ActivityModel } from "./activityFormat";

interface ActivityViewProps {
  model: ActivityModel;
  onOpenPhoto: (photoId: number) => void;
  onCancelJob: (jobId: number) => void;
  onStopImport: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
}

const KIND_ICONS: Record<string, React.ReactNode> = {
  import: <FolderInput size={20} />,
  enhance: <Sparkles size={20} />,
  video: <Film size={20} />,
  models: <CloudDownload size={20} />,
};

const Thumb: React.FC<{ item: ActivityItem; size?: "row" | "tile" }> = ({ item, size = "row" }) => {
  const cls = `act-thumb act-thumb-${size}`;
  if (item.private) {
    return (
      <span className={`${cls} is-private`} aria-label="Private photo">
        <Lock size={size === "row" ? 18 : 14} strokeWidth={2.4} />
      </span>
    );
  }
  if (item.photoId !== undefined) {
    return <img className={cls} src={getThumbnailUrl(item.photoId)} alt="" loading="lazy" />;
  }
  return <span className={`${cls} is-icon`} aria-hidden="true">{KIND_ICONS[item.kind] ?? <Sparkles size={20} />}</span>;
};

export const ActivityView: React.FC<ActivityViewProps> = ({ model, onOpenPhoto, onCancelJob, onStopImport, onPauseAll, onResumeAll }) => {
  const { working, waiting, ready, finished, remaining, paused } = model;
  const busy = working.length + waiting.length > 0;
  const meta = busy
    ? [`${working.length} working`, `${waiting.length} waiting`, paused ? "paused" : null].filter(Boolean).join(" · ")
    : ready.length
    ? `${ready.length} ready to look at`
    : "Nothing running";

  return (
    <div className="dash-page act-page">
      <div className="dash-header">
        <h1 className="dash-title">Activity</h1>
        <span className="dash-subtitle">{meta}</span>
        <div style={{ flex: 1 }} />
        {(busy || paused) && (
          <button type="button" className="dash-btn" onClick={paused ? onResumeAll : onPauseAll}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? "Resume" : "Pause all"}
          </button>
        )}
      </div>

      {!busy && !ready.length && !finished.length && (
        <div className="dash-empty">
          <h2>All done</h2>
          <p>Imports, enhancing, video preparation and old-photo improvements show here while they run.</p>
        </div>
      )}

      {working.length > 0 && (
        <section className="act-section" aria-label="Working now">
          <h2 className="dash-section-title">Working now</h2>
          <ul className="act-rows">
            {working.map((item) => (
              <li key={item.key} className="act-row">
                <Thumb item={item} />
                <div className="act-row-main">
                  <div className="act-row-line">
                    <strong>{item.title}</strong>
                    <span className="act-row-detail">{item.detail}</span>
                    {item.progress !== null && <span className="act-row-pct">{item.progress}%</span>}
                  </div>
                  <div className="act-bar" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress ?? undefined}>
                    <div style={{ width: `${item.progress ?? 0}%` }} className={item.progress === null ? "is-indeterminate" : ""} />
                  </div>
                </div>
                {item.cancel === "job" && item.jobId !== undefined && (
                  <button type="button" className="dash-btn act-cancel" onClick={() => onCancelJob(item.jobId!)}>Cancel</button>
                )}
                {item.cancel === "import" && (
                  <button type="button" className="dash-btn act-cancel" onClick={onStopImport}>Stop import</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="act-section" aria-label="Waiting">
          <h2 className="dash-section-title">Waiting · {waiting.length.toLocaleString()}</h2>
          <ul className="act-tiles">
            {waiting.map((item) => (
              <li key={item.key} className="act-tile is-waiting">
                <Thumb item={item} size="tile" />
                <span className="act-tile-label">{item.title}</span>
                {item.jobId !== undefined && (
                  <button type="button" className="act-tile-link" onClick={() => onCancelJob(item.jobId!)} aria-label={`Cancel: ${item.title}, ${item.detail}`}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ready.length > 0 && (
        <section className="act-section" aria-label="Ready to look at">
          <h2 className="dash-section-title">Ready to look at · {ready.length.toLocaleString()}</h2>
          <ul className="act-tiles">
            {ready.map((item) => (
              <li key={item.key} className="act-tile">
                <Thumb item={item} size="tile" />
                <span className="act-tile-label">{item.title.split(" · ")[0]}</span>
                <button type="button" className="act-tile-link is-strong" onClick={() => item.photoId !== undefined && onOpenPhoto(item.photoId)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section className="act-section" aria-label="Finished today">
          <h2 className="dash-section-title">Finished today · {finished.length.toLocaleString()}</h2>
          <ul className="act-tiles">
            {finished.map((item) => (
              <li key={item.key} className="act-tile">
                <Thumb item={item} size="tile" />
                <span className="act-tile-label">{item.outcome}</span>
                {item.photoId !== undefined && (
                  <button type="button" className="act-tile-link" onClick={() => onOpenPhoto(item.photoId!)}>Open</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {remaining > 0 && <p className="dash-muted">Everything runs on this computer. You can keep using the app; automatic work waits while the laptop is on battery.</p>}
    </div>
  );
};
