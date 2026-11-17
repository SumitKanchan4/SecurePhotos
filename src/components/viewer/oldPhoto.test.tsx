/**
 * H10 / A3: old-photo improvements in the viewer. Nothing shows until asked; the result comes
 * first; then Keep both / Replace / Discard (or the remembered choice).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { PhotoItem } from "../../types";
import { Lightbox } from "../Lightbox";

vi.mock("../../services/external", () => ({ openExternal: vi.fn() }));

const photo = (id: number, extra: Partial<PhotoItem> = {}): PhotoItem => ({
  id,
  filename: `old_${id}.jpg`,
  filepath: `originals/old_${id}.jpg`,
  file_size: 1000,
  mime_type: "image/jpeg",
  width: 800,
  height: 600,
  is_favorite: false,
  is_encrypted: false,
  is_optimized: true,
  is_enhanced: true,
  ...extra,
});

type Route = (url: string, init?: RequestInit) => unknown;

function mockEngine(routes: Record<string, Route>) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://127.0.0.1:50123", "");
    calls.push({ url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    const data = key ? routes[key](path, init) : {};
    return new Response(JSON.stringify(data ?? {}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const reviewJob = { id: 5, photo_id: 1, kind: "colour", status: "review", progress: 100, error: null, result_photo_id: null };

function renderViewer(photos = [photo(1), photo(2)], props: Partial<React.ComponentProps<typeof Lightbox>> = {}) {
  const handlers = { onClose: vi.fn(), onNavigate: vi.fn(), onLibraryChanged: vi.fn() };
  render(<Lightbox photos={photos} currentIndex={0} isOpen {...handlers} {...props} />);
  return handlers;
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", selectedPhotoIds: new Set<number>(), searchQuery: "", pendingOpen: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Old photos in the viewer", () => {
  it("shows nothing extra until asked, and offers only the improvement that fits", async () => {
    mockEngine({ "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: null }) });
    renderViewer();
    expect(screen.queryByRole("complementary", { name: "Add colour" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /Add colour/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Fix faded colours/ })).not.toBeInTheDocument();
  });

  it("offers Fix faded colours for a faded colour photo", async () => {
    mockEngine({ "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: true }, members: [], job: null }) });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(screen.getByRole("menuitem", { name: /Fix faded colours/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Add colour/ })).not.toBeInTheDocument();
  });

  it("has no More button for a photo nothing fits (or a video)", async () => {
    const calls = mockEngine({ "/api/restore/photos/": () => ({ options: { colour: false, fade: false }, members: [], job: null }) });
    renderViewer();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/restore/photos/1/state")).toBe(true));
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });

  it("queues the job, shows progress, then the before/after and the panel", async () => {
    let job: Record<string, unknown> = { ...reviewJob, status: "working", progress: 40 };
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: null }),
      "/api/restore/jobs/5/result": () => ({}),
      "/api/restore/jobs": (_u, init) => (init?.method === "POST" ? { job_ids: [5] } : { working: [job], waiting: [], review: [], finished_today: [], download: null }),
    });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Add colour/ }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs" && c.body)?.body).toEqual({ photo_ids: [1], kind: "colour", params: { style: "natural" } }));
    expect(await screen.findByText(/Adding colour · 40%/, {}, { timeout: 3000 })).toBeInTheDocument();
    job = { ...reviewJob };
    expect(await screen.findByRole("img", { name: "After" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Compare before and after" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep this…" })).toBeInTheDocument();
  });

  it("asks Keep both / Replace after the result, and sends the choice with the strength", async () => {
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: reviewJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
      "/api/restore/jobs/5/keep": () => ({ photo_id: 77 }),
    });
    const handlers = renderViewer();
    fireEvent.change(await screen.findByLabelText("Strength"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep this…" }));
    const dialog = await screen.findByRole("dialog", { name: "Keep the improved photo?" });
    expect(dialog).toHaveTextContent("The original goes to Trash. You can restore it for 30 days.");
    fireEvent.click(screen.getByRole("radio", { name: /Replace the photo/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Remember my choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace the photo" }));
    await waitFor(() => expect(handlers.onLibraryChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toEqual({ choice: "replace", remember: true, intensity: 0.6 });
    expect(handlers.onClose).toHaveBeenCalled(); // The original is now in Trash.
  });

  it("skips the question when a choice was remembered", async () => {
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: reviewJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "keep_both" } }),
      "/api/restore/jobs/5/keep": () => ({ photo_id: 77 }),
    });
    const handlers = renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(handlers.onLibraryChanged).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Keep the improved photo?" })).not.toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toMatchObject({ choice: "keep_both" });
    expect(handlers.onClose).not.toHaveBeenCalled(); // Keep both: stay on the photo.
  });

  it("Discard keeps nothing and closing the panel discards too", async () => {
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: reviewJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
      "/api/restore/jobs/5/keep": () => ({ photo_id: null }),
    });
    const handlers = renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toMatchObject({ choice: "discard" }));
    expect(handlers.onLibraryChanged).not.toHaveBeenCalled();
  });

  it("locks an action whose model is missing and asks before downloading; Not now keeps it locked", async () => {
    const calls = mockEngine({ "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, downloads: { colour: 1.96e9 }, members: [], job: null }) });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const item = screen.getByRole("menuitem", { name: /Add colour/ });
    expect(item).toHaveTextContent("Needs a one-time download · 2.0 GB");
    fireEvent.click(item);
    const dialog = await screen.findByRole("dialog", { name: "Add colour needs a one-time download" });
    expect(dialog).toHaveTextContent("(2.0 GB)");
    expect(dialog).toHaveTextContent("everything else in SecurePhotos works as usual");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: /needs a one-time download/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/restore/jobs") || c.url.startsWith("/api/restore/models"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Add colour/ }));
    expect(await screen.findByRole("dialog", { name: /needs a one-time download/ })).toBeInTheDocument();
  });

  it("downloads in the popup with progress, then starts the action", async () => {
    let tick = 0;
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, downloads: { colour: 2e9 }, members: [], job: null }),
      "/api/restore/models/download": () => ({ started: true, bytes: 2e9 }),
      "/api/restore/models": () => (++tick === 1 ? { models: [], download: { model: "ddcolor_large", done: 1e9, total: 2e9 }, result: null } : { models: [], download: null, result: "done" }),
      "/api/restore/jobs": (_u, init) => (init?.method === "POST" ? { job_ids: [9] } : { working: [], waiting: [], review: [], finished_today: [], download: null }),
    });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Add colour/ }));
    await act(async () => fireEvent.click(within(await screen.findByRole("dialog", { name: /needs a one-time download/ })).getByRole("button", { name: "Download" })));
    expect(calls.find((c) => c.url === "/api/restore/models/download")?.body).toEqual({ kind: "colour" });
    expect(await screen.findByText(/1\.0 GB of 2\.0 GB/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep browsing" })).toBeInTheDocument();
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs" && c.body)?.body).toEqual({ photo_ids: [1], kind: "colour", params: { style: "natural" } }), { timeout: 4000 });
    expect(screen.queryByRole("dialog", { name: /needs a one-time download/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("complementary", { name: "Add colour" })).toBeInTheDocument();
  });

  it("says so when the download fails and offers to try again; Cancel download stops it", async () => {
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, downloads: { colour: 2e9 }, members: [], job: null }),
      "/api/restore/models/download": () => ({ started: true, bytes: 2e9 }),
      "/api/restore/models/cancel-download": () => ({ cancelling: true }),
      "/api/restore/models": () => ({ models: [], download: null, result: "failed" }),
    });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Add colour/ }));
    await act(async () => fireEvent.click(within(await screen.findByRole("dialog", { name: /needs a one-time download/ })).getByRole("button", { name: "Download" })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/restore/models/cancel-download")).toBe(true));
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("Couldn't download it");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/restore/jobs" && c.body)).toBe(false);
  });

  it("a job that needed a model offers the same popup", async () => {
    mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: { ...reviewJob, status: "failed", error: "models_missing" } }),
    });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "Download…" }));
    expect(await screen.findByRole("dialog", { name: "Add colour needs a one-time download" })).toBeInTheDocument();
  });

  it("switches between the original and the improved photo", async () => {
    mockEngine({
      "/api/restore/photos/1/state": () => ({
        options: { colour: false, fade: false },
        members: [{ id: 1, is_original: true, ai_kind: null, trashed: false }, { id: 2, is_original: false, ai_kind: "colour", trashed: false }],
        job: null,
      }),
    });
    const handlers = renderViewer([photo(1), photo(2, { derived_from_id: 1, ai_kind: "colour" })]);
    const improved = await screen.findByRole("button", { name: "Improved" });
    expect(screen.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(improved);
    expect(handlers.onNavigate).toHaveBeenCalledWith(1);
  });
});

describe("Old photos: keyboard", () => {
  it("Escape in the keep dialog closes only the dialog; arrows on the strength slider don't switch photos", async () => {
    mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: true, fade: false }, members: [], job: reviewJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
    });
    const handlers = renderViewer();
    const slider = await screen.findByLabelText("Strength");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep this…" }));
    await screen.findByRole("dialog", { name: "Keep the improved photo?" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keep the improved photo?" })).not.toBeInTheDocument());
    expect(handlers.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" }); // Now it closes the viewer, as before.
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
