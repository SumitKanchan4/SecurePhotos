/**
 * Keeps photos showing when the engine's image login is lost (owner report 2026-11-19: a blank
 * grid). Images and videos can't send the app's token, so they use a login cookie, which lasts
 * only until the engine restarts. After a restart the app's other requests still worked but
 * every image was refused, and nothing logged in again.
 *
 * One listener catches any engine image or video that fails to load; it logs in again (at most
 * once every few seconds) and reloads every engine image that broke. Pure helpers are exported
 * for tests.
 */
import { useAppStore } from "../store/useAppStore";
import { performHandshake } from "./api";

/** Minimum time between two automatic logins. */
export const RENEW_EVERY_MS = 5000;

let renewing: Promise<boolean> | null = null;
let lastRenewal = 0;
/** Engine images and videos that reported a failure since the last login. */
let failed = new Set<HTMLImageElement | HTMLVideoElement>();

/** The same address with a fresh ``s=`` value, so the browser asks again instead of reusing the failure. */
export function withRetryMark(src: string, mark: number): string {
  const url = new URL(src);
  url.searchParams.set("s", String(mark));
  return url.toString();
}

function isEngineMedia(el: EventTarget | null, base: string): el is HTMLImageElement | HTMLVideoElement {
  if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement) || !base) return false;
  const src = el.currentSrc || el.src;
  return Boolean(src) && src.startsWith(base);
}

/** Logs in again and reloads the engine images that failed. Returns whether it logged in. */
export async function renewMediaSession(now = Date.now()): Promise<boolean> {
  if (renewing) return renewing;
  if (now - lastRenewal < RENEW_EVERY_MS) return false;
  lastRenewal = now;
  const { apiBaseUrl, apiToken } = useAppStore.getState();
  if (!apiToken) return false;
  renewing = (async () => {
    const ok = await performHandshake(apiBaseUrl, apiToken);
    if (ok) {
      const mark = Date.now();
      const broken = new Set(failed);
      failed = new Set();
      document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        if (img.src.startsWith(apiBaseUrl) && img.complete && img.naturalWidth === 0) broken.add(img);
      });
      document.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
        if (video.src.startsWith(apiBaseUrl) && video.error) broken.add(video);
      });
      broken.forEach((el) => {
        if (el.isConnected && el.src.startsWith(apiBaseUrl)) el.src = withRetryMark(el.src, mark);
      });
    }
    return ok;
  })();
  try {
    return await renewing;
  } finally {
    renewing = null;
  }
}

/** Starts watching for failed engine images; returns a function that stops it. */
export function watchMediaSession(): () => void {
  const onError = (e: Event) => {
    if (isEngineMedia(e.target, useAppStore.getState().apiBaseUrl)) {
      failed.add(e.target);
      void renewMediaSession();
    }
  };
  // Media errors don't bubble: listen in the capture phase.
  window.addEventListener("error", onError, true);
  return () => window.removeEventListener("error", onError, true);
}

/** For tests: forget the last renewal time. */
export function resetMediaSessionForTests(): void {
  renewing = null;
  lastRenewal = 0;
  failed = new Set();
}
