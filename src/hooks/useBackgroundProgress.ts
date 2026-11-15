/**
 * Background work the Photos header reports (Q5: moved out of App.tsx unchanged): photo
 * enhancement, video preparation and imports, polled every second. A photo that finishes
 * enhancing is marked at once; when a whole batch ends the library reloads.
 */
import { useEffect, useRef, useState } from "react";
import type { ImportProgressState, OptimizationProgress, VideoOptimizationProgress } from "../types";
import { apiFetch } from "../services/api";

interface BackgroundProgressHandlers {
  /** One photo just finished enhancing. */
  onPhotoEnhanced: (photoId: number) => void;
  /** A batch of enhancement, video preparation or import ended. */
  onBatchFinished: () => void;
}

export function useBackgroundProgress(onEvents: BackgroundProgressHandlers) {
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [videoProgress, setVideoProgress] = useState<VideoOptimizationProgress | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const handlers = useRef(onEvents);
  handlers.current = onEvents;

  useEffect(() => {
    let wasPhotoActive = false;
    let wasVideoActive = false;
    let wasImportActive = false;
    let lastPhotoCompletedCount = 0;

    const interval = setInterval(async () => {
      try {
        const [photoRes, videoRes, importRes] = await Promise.all([
          apiFetch("/api/photos/optimization-progress").catch(() => null),
          apiFetch("/api/videos/optimization-progress").catch(() => null),
          apiFetch("/api/photos/import-progress").catch(() => null),
        ]);

        if (photoRes && photoRes.ok) {
          const photoData: OptimizationProgress = await photoRes.json();
          setOptimizationProgress(photoData);

          // If an individual photo just finished optimizing, immediately update its badge locally
          if (photoData.completed_count > lastPhotoCompletedCount) {
            lastPhotoCompletedCount = photoData.completed_count;
            if (photoData.last_completed_photo_id) {
              handlers.current.onPhotoEnhanced(photoData.last_completed_photo_id);
            }
          }

          // If the entire active photo batch completed, do a single clean reload
          if (wasPhotoActive && !photoData.is_active) {
            handlers.current.onBatchFinished();
            lastPhotoCompletedCount = 0;
          }
          wasPhotoActive = photoData.is_active;
        }

        if (videoRes && videoRes.ok) {
          const videoData: VideoOptimizationProgress = await videoRes.json();
          setVideoProgress(videoData);

          // When video batch completes, reload photos & timeline
          if (wasVideoActive && !videoData.is_active) {
            handlers.current.onBatchFinished();
          }
          wasVideoActive = videoData.is_active;
        }

        if (importRes && importRes.ok) {
          const importData: ImportProgressState = await importRes.json();
          setImportProgress(importData);

          // When media import batch completes, refresh library photos & timeline
          if (wasImportActive && !importData.is_active) {
            handlers.current.onBatchFinished();
          }
          wasImportActive = importData.is_active;
        }
      } catch {}
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return { optimizationProgress, videoProgress, importProgress };
}
