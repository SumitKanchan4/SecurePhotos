/**
 * Plain words for an update that didn't install (T18). The updater's own errors are technical
 * ("signature verification failed: …"); people need to know what happened and what to do.
 */

/** Where the newest installer can always be downloaded by hand. */
export const RELEASES_URL = "https://github.com/SumitKanchan4/SecurePhotos/releases/latest";

export function updateErrorText(err: unknown): string {
  const raw = String((err as { message?: unknown })?.message ?? err ?? "").toLowerCase();
  if (raw.includes("signature") || raw.includes("pubkey") || raw.includes("public key")) {
    return "This update couldn't be checked, so it wasn't installed. Download the installer and run it once; after that, updates install from here.";
  }
  if (raw.includes("network") || raw.includes("connect") || raw.includes("timed out") || raw.includes("dns") || raw.includes("request")) {
    return "The update couldn't be downloaded. Check your internet connection and try again.";
  }
  return "The update didn't install. Your photos are fine. Try again, or download the installer and run it.";
}
