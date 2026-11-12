/**
 * Opens web links in the user's default browser, never inside the app (H5).
 *
 * The app window has a strict Content Security Policy and is the only window
 * with Tauri permissions, so external pages must not load inside it. Links go
 * through the shell plugin's "open" command (the only shell permission granted).
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * Opens an http(s) URL in the default browser.
 *
 * @param url - Absolute http:// or https:// URL. Anything else is ignored.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    console.warn("Refusing to open non-web link:", url);
    return;
  }
  try {
    await invoke("plugin:shell|open", { path: url });
  } catch {
    // Outside the desktop app (e.g. plain browser during development).
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
