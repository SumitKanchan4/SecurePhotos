/**
 * The Dashboard tiles (T32, owner-approved mock-up 2026-11-22): On this day, Just added, Brought
 * back, People, Your year and Worth doing. Each tile is left out when it has nothing to show;
 * the words come from dashFormat.
 */
import React, { useState } from "react";
import { Check, ChevronRight, ChevronsLeftRight, Copy, Film, Play, Sparkles, Trash2, UserRound } from "lucide-react";
import { getApiUrl, getThumbnailUrl } from "../../services/api";
import {
  broughtBackText,
  formatSize,
  justAddedText,
  monthBars,
  onThisDayText,
  plural,
  type Highlights,
  type WorthJob,
} from "./dashFormat";

const Thumb: React.FC<{ id: number; className?: string }> = ({ id, className }) => (
  <img className={className} src={getThumbnailUrl(id)} alt="" loading="lazy" draggable={false} />
);

export const OnThisDayTile: React.FC<{
  memory: NonNullable<Highlights["on_this_day"]>;
  now: Date;
  onPlay?: (storyId: number) => void;
  onOpenPhoto?: (photoId: number) => void;
}> = ({ memory, now, onPlay, onOpenPhoto }) => {
  const { title, line } = onThisDayText(memory, now);
  const [first, ...rest] = memory.photo_ids;
  return (
    <article className={`dash-tile dash-memory${rest.length ? "" : " is-single"}`} aria-labelledby="dash-memory-title">
      <button type="button" className="dash-memory-photo dash-memory-main" onClick={() => onOpenPhoto?.(first)} aria-label="Open the first photo">
        <Thumb id={first} />
      </button>
      {rest.slice(0, 2).map((id) => (
        <button key={id} type="button" className="dash-memory-photo" onClick={() => onOpenPhoto?.(id)} aria-label="Open this photo">
          <Thumb id={id} />
        </button>
      ))}
      <div className="dash-memory-caption">
        <div className="dash-memory-text">
          <p className="dash-kicker">On this day</p>
          <h2 id="dash-memory-title">{title}</h2>
          <p>{line}</p>
        </div>
        {memory.story_id != null && onPlay && (
          <button type="button" className="dash-btn dash-btn-primary dash-memory-play" onClick={() => onPlay(memory.story_id!)}>
            <Play size={16} fill="currentColor" aria-hidden="true" />
            Play as a story
          </button>
        )}
      </div>
    </article>
  );
};

export const JustAddedTile: React.FC<{
  added: NonNullable<Highlights["just_added"]>;
  onOpenPhotos: () => void;
  onOpenActivity: () => void;
}> = ({ added, onOpenPhotos, onOpenActivity }) => {
  const { title, preparing } = justAddedText(added);
  const total = added.photos + added.videos;
  const shown = added.photo_ids.slice(0, 3);
  const more = total - shown.length;
  const ready = total > 0 ? (total - added.preparing) / total : 1;
  return (
    <article className="dash-tile dash-card" aria-labelledby="dash-added-title">
      <div className="dash-tile-head">
        <h2 id="dash-added-title">Just added</h2>
        <span className="dash-muted">Last 24 hours</span>
      </div>
      <button type="button" className="dash-added-grid" onClick={onOpenPhotos} aria-label={`${title}, open Photos`}>
        {shown.map((id) => (
          <Thumb key={id} id={id} />
        ))}
        {more > 0 && <span className="dash-added-more">+{more.toLocaleString()}</span>}
      </button>
      <p className="dash-tile-title">{title}</p>
      {preparing && (
        <div className="dash-tile-foot">
          <svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true" className="dash-ring">
            <circle cx="18" cy="18" r="14" className="dash-ring-track" />
            <circle cx="18" cy="18" r="14" className="dash-ring-fill" strokeDasharray={`${Math.round(ready * 88)} 88`} transform="rotate(-90 18 18)" />
          </svg>
          <span className="dash-muted">{preparing}</span>
          <span className="dash-spacer" />
          <button type="button" className="dash-link" onClick={onOpenActivity}>
            Activity <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
};

export const BroughtBackTile: React.FC<{
  back: NonNullable<Highlights["brought_back"]>;
  onOpenPhoto?: (photoId: number) => void;
}> = ({ back, onOpenPhoto }) => {
  const [split, setSplit] = useState(52);
  return (
    <article className="dash-tile dash-card" aria-labelledby="dash-back-title">
      <div className="dash-tile-head">
        <h2 id="dash-back-title">Brought back</h2>
        {back.total > 1 && <span className="dash-muted">{plural(back.total, "old photo")}</span>}
      </div>
      <div className="dash-compare">
        <Thumb id={back.before_id} className="dash-compare-img" />
        <img
          className="dash-compare-img"
          src={getThumbnailUrl(back.after_id)}
          alt=""
          draggable={false}
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        />
        <span className="dash-compare-line" style={{ left: `${split}%` }} aria-hidden="true">
          <span className="dash-compare-knob">
            <ChevronsLeftRight size={16} />
          </span>
        </span>
        <span className="dash-compare-tag is-before" aria-hidden="true">Before</span>
        <span className="dash-compare-tag is-after" aria-hidden="true">After</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          className="dash-compare-range"
          aria-label="Compare before and after"
        />
      </div>
      <div className="dash-tile-foot">
        <span className="dash-muted">{broughtBackText(back.kinds)}</span>
        <span className="dash-spacer" />
        <button type="button" className="dash-link" onClick={() => onOpenPhoto?.(back.after_id)}>
          Open <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
};

export const PeopleTile: React.FC<{
  people: Highlights["people"];
  total: number;
  onOpenPerson: (id: number) => void;
  onOpenPeople: () => void;
}> = ({ people, total, onOpenPerson, onOpenPeople }) => (
  <article className="dash-tile dash-card" aria-labelledby="dash-people-title">
    <div className="dash-tile-head">
      <h2 id="dash-people-title">People</h2>
      <span className="dash-spacer" />
      <button type="button" className="dash-link" onClick={onOpenPeople}>
        {total > people.top.length ? `All ${total.toLocaleString()}` : "People"} <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
    {people.top.length > 0 && (
      <ul className="dash-people">
        {people.top.map((p) => (
          <li key={p.id}>
            <button type="button" className={`dash-person${p.close ? " is-close" : ""}`} onClick={() => onOpenPerson(p.id)}>
              {p.face_id ? (
                <img src={getApiUrl(`/api/people/faces/${p.face_id}/crop`)} alt="" loading="lazy" draggable={false} />
              ) : (
                <span className="dash-person-blank" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="dash-person-name">{p.name}</span>
              <span className="dash-muted">{plural(p.photo_count, "photo")}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
    {people.to_name > 0 && (
      <button type="button" className="dash-callout" onClick={onOpenPeople}>
        <UserRound size={16} aria-hidden="true" />
        {people.to_name === 1 ? "1 new face waiting for a name" : `${people.to_name.toLocaleString()} new faces waiting for a name`}
        <span className="dash-spacer" />
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    )}
  </article>
);

export const YearTile: React.FC<{ year: number; months: number[]; now: Date; onOpenMonth: (key: string) => void }> = ({ year, months, now, onOpenMonth }) => {
  const { bars, total, busiest } = monthBars(year, months, now);
  return (
    <article className="dash-tile dash-card" aria-labelledby="dash-year-title">
      <div className="dash-tile-head">
        <h2 id="dash-year-title">Your {year}</h2>
        <span className="dash-muted">{plural(total, "photo")}</span>
      </div>
      <div className="dash-months">
        {bars.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`dash-month${b.current ? " is-current" : ""}${b.busiest ? " is-busiest" : ""}`}
            onClick={() => onOpenMonth(b.key)}
            disabled={b.count === 0}
            aria-label={`${b.name}: ${plural(b.count, "photo")}`}
            title={`${b.name}: ${plural(b.count, "photo")}`}
          >
            <span className="dash-month-track">
              <span className="dash-month-bar" style={{ height: `${b.height}%` }} />
            </span>
            <span className="dash-month-letter" aria-hidden="true">
              {b.letter}
            </span>
          </button>
        ))}
      </div>
      <p className="dash-muted">{busiest ? `${busiest} · click a month to open it` : "No photos taken this year yet."}</p>
    </article>
  );
};

const JOB_ICON: Record<WorthJob["key"], React.ReactNode> = {
  duplicates: <Copy size={18} />,
  keep: <Sparkles size={18} />,
  videos: <Film size={18} />,
  trash: <Trash2 size={18} />,
};

export const WorthDoing: React.FC<{ jobs: WorthJob[]; onOpen: (key: WorthJob["key"]) => void }> = ({ jobs, onOpen }) => {
  const total = jobs.reduce((sum, j) => sum + j.bytes, 0);
  const known = jobs.every((j) => j.state !== "checking");
  return (
    <section className="dash-worth" aria-labelledby="dash-worth">
      <div className="dash-tile-head">
        <h2 id="dash-worth" className="dash-section-title">
          Worth doing
        </h2>
        {total > 0 ? (
          <span className="dash-muted">About {formatSize(total)} to free</span>
        ) : (
          known && <span className="dash-muted">All good, nothing to free right now</span>
        )}
      </div>
      <div className="dash-jobs">
        {jobs.map((j) => (
          <button
            key={j.key}
            type="button"
            className={`dash-job is-${j.state}`}
            onClick={() => onOpen(j.key)}
            disabled={j.state === "off"}
          >
            <span className="dash-job-top">
              <span className="dash-job-icon" aria-hidden="true">
                {JOB_ICON[j.key]}
              </span>
              <span className="dash-job-title">{j.title}</span>
              <span className="dash-spacer" />
              <ChevronRight size={16} className="dash-job-chev" aria-hidden="true" />
            </span>
            <span className="dash-muted">{j.line}</span>
            {j.state === "free" ? (
              <span className="dash-job-gain">{formatSize(j.bytes)}</span>
            ) : j.state === "good" ? (
              <span className="dash-job-gain is-good">
                <Check size={22} strokeWidth={3} aria-hidden="true" />
                All good
              </span>
            ) : (
              <span className="dash-job-gain is-quiet" aria-hidden="true">
                –
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};
