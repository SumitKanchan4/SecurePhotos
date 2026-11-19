import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { RENEW_EVERY_MS, renewMediaSession, resetMediaSessionForTests, watchMediaSession, withRetryMark } from "./mediaSession";

const BASE = "http://127.0.0.1:50123";

describe("image login recovery (owner report 2026-11-19: blank grid after an engine restart)", () => {
  beforeEach(() => {
    resetMediaSessionForTests();
    useAppStore.setState({ apiBaseUrl: BASE, apiToken: "t" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("logs in again when an engine image fails, and reloads the broken images", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const broken = document.createElement("img");
    broken.src = `${BASE}/api/photos/7/thumbnail?v=3`;
    const elsewhere = document.createElement("img");
    elsewhere.src = "https://example.com/a.png";
    document.body.append(broken, elsewhere);
    const stop = watchMediaSession();

    elsewhere.dispatchEvent(new Event("error"));
    expect(fetchMock).not.toHaveBeenCalled(); // Not an engine image.

    broken.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/api/auth/handshake`);
    await vi.waitFor(() => expect(broken.src).toMatch(/[?&]s=\d+/));
    expect(broken.src).toContain("v=3");
    expect(elsewhere.src).toBe("https://example.com/a.png");
    stop();
  });

  it("logs in at most once every few seconds, however many images fail", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await renewMediaSession(1_000_000);
    await renewMediaSession(1_000_000 + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await renewMediaSession(1_000_000 + RENEW_EVERY_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks a retried address without losing its other parts", () => {
    expect(withRetryMark(`${BASE}/api/photos/1/preview`, 5)).toBe(`${BASE}/api/photos/1/preview?s=5`);
    expect(withRetryMark(`${BASE}/api/photos/1/thumbnail?v=3&s=1`, 9)).toBe(`${BASE}/api/photos/1/thumbnail?v=3&s=9`);
  });
});
