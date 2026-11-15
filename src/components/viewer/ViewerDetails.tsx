/**
 * The viewer's details panel (Q5: moved out of Lightbox.tsx unchanged): when and where the
 * photo was taken, camera, size and quality, file, import, and the people and albums in it.
 * Follows the app theme while the viewer around it stays dark.
 */
import React from "react";
import { Check, Copy, ExternalLink, Loader2, Printer, Sparkles, X } from "lucide-react";
import type { PhotoContext, PhotoItem } from "../../types";
import { getApiUrl } from "../../services/api";
import { openExternal } from "../../services/external";
import {
  cameraName,
  coordinatesLine,
  dimensionsLine,
  exposureLine,
  formatDay,
  formatTime,
  parseTakenAt,
  printLine,
  storageLine,
} from "./viewerFormat";

/** One labelled block in the details panel. */
const DetailSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="viewer-section">
    <h4>{label}</h4>
    {children}
  </section>
);

interface ViewerDetailsProps {
  photo: PhotoItem;
  context: PhotoContext | null;
  theme: string;
  isVideo: boolean;
  isVaultItem: boolean;
  /** Quality chip shown by the title ("4K", "8K"…); videos already 4K can't be enhanced. */
  chipLabel?: string;
  isEnhancing4K: boolean;
  isCopied: boolean;
  onClose: () => void;
  onDownloadPrint: () => void;
  onEnhanceVideo: () => void;
  onCopyPath: () => void;
  onOpenPerson: (id: number) => void;
  onOpenAlbum: (id: number) => void;
}

export const ViewerDetails: React.FC<ViewerDetailsProps> = ({
  photo,
  context,
  theme,
  isVideo,
  isVaultItem,
  chipLabel,
  isEnhancing4K,
  isCopied,
  onClose,
  onDownloadPrint,
  onEnhanceVideo,
  onCopyPath,
  onOpenPerson,
  onOpenAlbum,
}) => {
  const takenDate = parseTakenAt(photo.taken_at);
  const camera = cameraName(photo);
  const exposure = exposureLine(photo);
  const dimensions = dimensionsLine(photo);
  const importedDate = parseTakenAt(context?.imported_at);

  return (
    <aside className="viewer-details" data-theme={theme} aria-label="Details">
      <div className="viewer-details-head">
        <h3>Details</h3>
        <button type="button" className="viewer-close-details" aria-label="Close details" onClick={onClose}>
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>

      <DetailSection label="Taken">
        <p className="viewer-value">{takenDate ? formatDay(takenDate) : "Date unknown"}</p>
        {takenDate && /[ T]\d{2}:\d{2}/.test(photo.taken_at ?? "") && <p className="viewer-sub">{formatTime(takenDate)}</p>}
        {photo.latitude != null && photo.longitude != null && (
          <p className="viewer-sub">
            {coordinatesLine(photo.latitude, photo.longitude)}{" "}
            <a
              className="viewer-link"
              href={`https://www.openstreetmap.org/?mlat=${photo.latitude}&mlon=${photo.longitude}#map=16/${photo.latitude}/${photo.longitude}`}
              onClick={(e) => {
                // Open in the default browser, never inside the app (H5).
                e.preventDefault();
                openExternal(e.currentTarget.href);
              }}
            >
              Open map <ExternalLink size={11} />
            </a>
          </p>
        )}
      </DetailSection>

      {(camera || exposure) && (
        <DetailSection label="Camera">
          {camera && <p className="viewer-value">{camera}</p>}
          {exposure && <p className="viewer-sub">{exposure}</p>}
        </DetailSection>
      )}

      <DetailSection label={isVideo ? "Video" : "Photo"}>
        <p className="viewer-value">{dimensions ?? "Size unknown"}</p>
        <p className="viewer-sub">{storageLine(photo)}</p>
        {!isVideo && printLine(photo) && <p className="viewer-sub">{printLine(photo)}</p>}
        {!isVideo && !isVaultItem && (
          <button type="button" className="viewer-text-btn" onClick={onDownloadPrint}>
            <Printer size={13} /> Download print-ready copy
          </button>
        )}
        {isVideo && chipLabel !== "4K" && !isVaultItem && (
          <button type="button" className="viewer-text-btn" disabled={isEnhancing4K} onClick={onEnhanceVideo}>
            {isEnhancing4K ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {isEnhancing4K ? "Enhancing to 4K…" : "Enhance to 4K"}
          </button>
        )}
      </DetailSection>

      <DetailSection label="File">
        <p className="viewer-value viewer-break">{photo.filename}</p>
        <button type="button" className="viewer-text-btn" onClick={onCopyPath} title={photo.filepath}>
          {isCopied ? <Check size={13} /> : <Copy size={13} />}
          {isCopied ? "Location copied" : "Copy file location"}
        </button>
      </DetailSection>

      {importedDate && (
        <DetailSection label="Imported">
          <p className="viewer-value">{formatDay(importedDate)}</p>
          <p className="viewer-sub">{context?.copied_into_library ? "Copied into your library" : "Kept in its original folder"}</p>
        </DetailSection>
      )}

      {context && context.people.length > 0 && (
        <DetailSection label="People">
          <div className="viewer-faces">
            {context.people.map((person) => (
              <button key={person.id} type="button" className="viewer-face" onClick={() => onOpenPerson(person.id)} title={`See all photos of ${person.name}`}>
                {person.face_id ? (
                  <img src={getApiUrl(`/api/people/faces/${person.face_id}/crop`)} alt="" loading="lazy" />
                ) : (
                  <span className="viewer-face-initial">{person.name.charAt(0).toUpperCase()}</span>
                )}
                <span>{person.name}</span>
              </button>
            ))}
          </div>
        </DetailSection>
      )}

      {context && context.albums.length > 0 && (
        <DetailSection label="Albums">
          <div className="viewer-albums">
            {context.albums.map((album) => (
              <button key={album.id} type="button" className="viewer-album" onClick={() => onOpenAlbum(album.id)}>
                {album.name}
              </button>
            ))}
          </div>
        </DetailSection>
      )}
    </aside>
  );
};
