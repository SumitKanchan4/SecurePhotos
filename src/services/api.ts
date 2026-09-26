/**
 * Zero-Trust Local IPC API & Media URL Service for SecurePhotos.
 *
 * Centralizes all backend communication, ephemeral port routing,
 * and token-authenticated requests across the desktop client.
 */

import { useAppStore } from "../store/useAppStore";

export interface EngineConfig {
  port: number;
  token: string;
  base_url: string;
}

/**
 * Executes a fetch request against the dynamically configured SecurePhotos backend.
 * Automatically injects the X-SecurePhotos-Token header and includes session cookies.
 *
 * @param endpoint - Relative API route (e.g., '/api/photos' or 'api/vault/status')
 * @param options - Standard RequestInit options (method, body, headers, etc.)
 * @returns Standard fetch Response promise
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const { apiBaseUrl, apiToken } = useAppStore.getState();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${apiBaseUrl}${cleanEndpoint}`;

  const headers = new Headers(options.headers || {});
  if (apiToken) {
    headers.set("X-SecurePhotos-Token", apiToken);
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}

/**
 * Returns the fully qualified URL for an API or media endpoint.
 * In development without token, returns the plain URL.
 * When authenticated, the HttpOnly session cookie ensures <img src> and <video src>
 * tags load seamlessly.
 *
 * @param endpoint - Relative path (e.g. '/api/photos/1/thumbnail')
 * @returns Absolute URL with current host & port
 */
export function getApiUrl(endpoint: string): string {
  const { apiBaseUrl } = useAppStore.getState();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${apiBaseUrl}${cleanEndpoint}`;
}

/**
 * Returns current API base URL (e.g. 'http://127.0.0.1:54129')
 */
export function getApiBaseUrl(): string {
  return useAppStore.getState().apiBaseUrl;
}

/**
 * Helper to get the full API base prefix (e.g. 'http://127.0.0.1:54129/api')
 */
export function getApiRoot(): string {
  return `${useAppStore.getState().apiBaseUrl}/api`;
}

/**
 * Returns the media URL for a photo thumbnail.
 */
export function getThumbnailUrl(photoId: number, isVault = false): string {
  if (isVault) {
    return getApiUrl(`/api/vault/thumbnail/${photoId}`);
  }
  return getApiUrl(`/api/photos/${photoId}/thumbnail?v=3`);
}

/**
 * Returns the media URL for a 2K/4K photo preview.
 */
export function getPreviewUrl(photoId: number, isVault = false): string {
  if (isVault) {
    return getApiUrl(`/api/vault/stream/${photoId}`);
  }
  return getApiUrl(`/api/photos/${photoId}/preview`);
}

/**
 * Returns the media URL for a video stream.
 */
export function getVideoStreamUrl(photoId: number, isVault = false, version = 0): string {
  if (isVault) {
    return getApiUrl(`/api/vault/stream/${photoId}`);
  }
  const vQuery = version > 0 ? `?v=${version}` : "";
  return getApiUrl(`/api/videos/${photoId}/stream${vQuery}`);
}

/**
 * Performs the initial handshake with the backend to establish the session cookie.
 *
 * @param baseUrl - Base URL of the backend (e.g. 'http://127.0.0.1:54129')
 * @param token - Ephemeral 256-bit token issued by native Rust layer
 * @returns Boolean indicating whether handshake succeeded
 */
export async function performHandshake(baseUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/handshake`, {
      method: "POST",
      headers: {
        "X-SecurePhotos-Token": token,
      },
      credentials: "include",
    });
    return res.ok;
  } catch (err) {
    console.warn("Local IPC handshake attempt failed:", err);
    return false;
  }
}
