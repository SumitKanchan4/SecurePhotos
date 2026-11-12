import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import {
  apiFetch,
  getPreviewUrl,
  getThumbnailUrl,
  getVideoStreamUrl,
  performHandshake,
} from "./api";

const BASE = "http://127.0.0.1:50123";

function mockFetch(response: Response | Error = new Response("{}", { status: 200 })) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof mockFetch>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useAppStore.getState().setEngineConfig(BASE, "token-abc");
});

describe("apiFetch (H1/H6: every engine request is authenticated)", () => {
  it("sends the access token header and the session cookie", async () => {
    const fetchMock = mockFetch();
    await apiFetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" } });

    const [url, init] = call(fetchMock);
    expect(url).toBe(`${BASE}/api/photos`);
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("X-SecurePhotos-Token")).toBe("token-abc");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("adds the leading slash and never puts the token in the URL", async () => {
    const fetchMock = mockFetch();
    await apiFetch("api/vault/status");
    const [url] = call(fetchMock);
    expect(url).toBe(`${BASE}/api/vault/status`);
    expect(url).not.toContain("token");
  });

  it("sends no token header before the engine config is known", async () => {
    useAppStore.getState().setEngineConfig(BASE, null);
    const fetchMock = mockFetch();
    await apiFetch("/api/health");
    const [, init] = call(fetchMock);
    expect(new Headers(init.headers).has("X-SecurePhotos-Token")).toBe(false);
    expect(init.credentials).toBe("include");
  });
});

describe("media URLs point at the right routes", () => {
  it("library vs vault thumbnails and previews", () => {
    expect(getThumbnailUrl(7)).toBe(`${BASE}/api/photos/7/thumbnail?v=3`);
    expect(getThumbnailUrl(7, true)).toBe(`${BASE}/api/vault/thumbnail/7`);
    expect(getPreviewUrl(7)).toBe(`${BASE}/api/photos/7/preview`);
    expect(getPreviewUrl(7, true)).toBe(`${BASE}/api/vault/stream/7`);
  });

  it("video streams, with a cache-busting version only when given", () => {
    expect(getVideoStreamUrl(9)).toBe(`${BASE}/api/videos/9/stream`);
    expect(getVideoStreamUrl(9, false, 3)).toBe(`${BASE}/api/videos/9/stream?v=3`);
    expect(getVideoStreamUrl(9, true, 3)).toBe(`${BASE}/api/vault/stream/9`);
  });
});

describe("performHandshake", () => {
  it("posts the token once to get the session cookie", async () => {
    const fetchMock = mockFetch();
    expect(await performHandshake(BASE, "token-abc")).toBe(true);
    const [url, init] = call(fetchMock);
    expect(url).toBe(`${BASE}/api/auth/handshake`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("X-SecurePhotos-Token")).toBe("token-abc");
  });

  it("reports failure instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch(new TypeError("Failed to fetch"));
    expect(await performHandshake(BASE, "token-abc")).toBe(false);
    mockFetch(new Response("", { status: 401 }));
    expect(await performHandshake(BASE, "wrong")).toBe(false);
  });
});
