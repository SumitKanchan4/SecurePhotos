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
    expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toEqual({ choice: "replace", remember: true, intensity: 0.6, faces_off: [] });
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

  it("offers Sharpen faces for a photo with faces", async () => {
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: true, faces: true }, members: [], job: null }),
      "/api/restore/jobs": (_u, init) => (init?.method === "POST" ? { job_ids: [8] } : { working: [], waiting: [], review: [], finished_today: [], download: null }),
    });
    renderViewer();
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    const item = screen.getByRole("menuitem", { name: /Sharpen faces/ });
    expect(item).toHaveTextContent("Clearer faces in blurry or old photos");
    await act(async () => fireEvent.click(item));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs" && c.body)?.body).toEqual({ photo_ids: [1], kind: "faces", params: {} }));
  });

  it("outlines each face; clicking one keeps it as it was, in the preview and when keeping", async () => {
    const facesJob = {
      ...reviewJob,
      kind: "faces",
      faces: [
        { box: [0.1, 0.1, 0.2, 0.25], sharpened: true },
        { box: [0.4, 0.1, 0.2, 0.25], sharpened: true },
        { box: [0.7, 0.5, 0.1, 0.12], sharpened: false },
      ],
    };
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: false, faces: false }, members: [], job: facesJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "keep_both" } }),
      "/api/restore/jobs/5/keep": () => ({ photo_id: 78 }),
    });
    renderViewer();
    const first = await screen.findByRole("button", { name: "Face 1: sharpened" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Face 2: sharpened" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Face 3/ })).not.toBeInTheDocument(); // Left by the identity check: not a switch.
    const panel = screen.getByRole("complementary", { name: "Sharpen faces" });
    expect(panel).toHaveTextContent("2 faces sharpened · 1 left as it was (no longer looked like the same person).");
    fireEvent.click(first);
    expect(screen.getByRole("button", { name: "Face 1: as it was" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img", { name: "After" }).getAttribute("src")).toContain("faces_off=0");
    expect(panel).toHaveTextContent("1 face sharpened · 1 switched off");
    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toMatchObject({ choice: "keep_both", faces_off: [0] }));
  });

  it("offers Also sharpen faces after a faded-colour fix when the face model is missing", async () => {
    let tick = 0;
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: true, faces: true }, downloads: { faces: 3.4e8 }, members: [], job: { ...reviewJob, kind: "fade", faces: [], faces_waiting: 2 } }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
      "/api/restore/models/download": () => ({ started: true, bytes: 3.4e8 }),
      "/api/restore/models": () => (++tick < 1 ? {} : { models: [], download: null, result: "done" }),
      "/api/restore/jobs/5/keep": () => ({ photo_id: null }),
      "/api/restore/jobs": (_u, init) => (init?.method === "POST" ? { job_ids: [9] } : { working: [], waiting: [], review: [], finished_today: [], download: null }),
    });
    renderViewer();
    expect(await screen.findByText("There are 2 faces that could be sharpened too.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Also sharpen faces" }));
    const dialog = await screen.findByRole("dialog", { name: "Sharpen faces needs a one-time download" });
    expect(dialog).toHaveTextContent("the face model first (0.3 GB)");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Download" })));
    expect(calls.find((c) => c.url === "/api/restore/models/download")?.body).toEqual({ kind: "faces" });
    // Once it's here, Fix faded colours runs again (now with faces); the old result is discarded.
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs" && c.body)?.body).toEqual({ photo_ids: [1], kind: "fade", params: {} }), { timeout: 4000 });
    expect(calls.find((c) => c.url === "/api/restore/jobs/5/keep")?.body).toEqual({ choice: "discard" });
  });

  it("offers Remove scratches and spots, shows the marks and opens Touch up; Apply repairs again with the painted marks", async () => {
    const ctx = {
      drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })), putImageData: vi.fn(),
      globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineCap: "", lineJoin: "", lineWidth: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) {
      cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
    });
    const scratchJob = { ...reviewJob, kind: "scratches", marked: 0.012, faces: [], faces_waiting: 0 };
    const calls = mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: true, faces: false, scratches: true }, members: [], job: scratchJob }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
      "/api/restore/jobs/5/touch-up": () => ({ job_id: 6 }),
      "/api/restore/jobs/5/mask": () => ({}),
      "/api/restore/jobs": () => ({ working: [], waiting: [], review: [], finished_today: [], download: null }),
    });
    const handlers = renderViewer();
    const panel = await screen.findByRole("complementary", { name: "Remove scratches and spots" });
    expect(panel).toHaveTextContent("What was repaired is shown in lime.");
    expect(screen.getByRole("checkbox", { name: "Show marks" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Touch up/ }));
    const editor = await screen.findByRole("dialog", { name: "Touch up" });
    expect(within(editor).getByRole("button", { name: /Brush/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(editor).getByRole("button", { name: /Eraser/ }));
    expect(within(editor).getByRole("button", { name: /Eraser/ })).toHaveAttribute("aria-pressed", "true");
    expect(editor).toHaveTextContent("Faces under a mark are left alone unless you paint them.");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Touch up" })).not.toBeInTheDocument();
    expect(handlers.onClose).not.toHaveBeenCalled(); // Escape closed Touch up only, not the viewer.
    fireEvent.click(screen.getByRole("button", { name: /Touch up/ }));
    const again = await screen.findByRole("dialog", { name: "Touch up" });
    fireEvent.load(within(again).getByRole("img", { name: "The repaired photo" }));
    await act(async () => fireEvent.click(within(again).getByRole("button", { name: "Apply" })));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/restore/jobs/5/touch-up")?.body).toEqual({ mask_png: "iVBORw==" }));
    expect(screen.queryByRole("dialog", { name: "Touch up" })).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("says when nothing was found and still offers Touch up", async () => {
    mockEngine({
      "/api/restore/photos/1/state": () => ({ options: { colour: false, fade: false, faces: false, scratches: true }, members: [], job: { ...reviewJob, kind: "scratches", marked: 0 } }),
      "/api/system/settings": () => ({ settings: { old_photos_keep_choice: "ask" } }),
    });
    renderViewer();
    const panel = await screen.findByRole("complementary", { name: "Remove scratches and spots" });
    expect(panel).toHaveTextContent("No scratches or spots were found.");
    expect(screen.queryByRole("checkbox", { name: "Show marks" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Touch up/ })).toBeInTheDocument();
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

  it("swaps in the original when the library shows only the improved photo (A8 stack)", async () => {
    mockEngine({
      "/api/restore/photos/2/state": () => ({
        options: { colour: false, fade: false },
        members: [{ id: 1, is_original: true, ai_kind: null, trashed: false }, { id: 2, is_original: false, ai_kind: "colour", trashed: false }],
        job: null,
      }),
    });
    const onShowVersion = vi.fn();
    const handlers = renderViewer([photo(2, { derived_from_id: 1, ai_kind: "colour" }), photo(9)], { onShowVersion });
    fireEvent.click(await screen.findByRole("button", { name: "Original" }));
    expect(onShowVersion).toHaveBeenCalledWith(1);
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Choose what to keep" })).not.toBeInTheDocument(); // Chosen already.
  });

  it.each([
    ["Keep improved", "keep_improved", 2, "The original is in Trash for 30 days."],
    ["Keep both", "keep_both", 2, "Both kept."],
    ["Keep original", "keep_original", 1, "The improved photo is in Trash for 30 days."],
  ])("asks what to keep of a photo improved automatically: %s", async (label, choice, keepId, message) => {
    const calls = mockEngine({
      "/api/restore/photos/2/state": () => ({
        options: { colour: false, fade: false },
        members: [
          { id: 1, is_original: true, ai_kind: null, trashed: false, choice_pending: false },
          { id: 2, is_original: false, ai_kind: "colour", trashed: false, choice_pending: true },
        ],
        job: null,
      }),
      "/api/restore/choices": () => ({ applied: 1 }),
    });
    const showToast = vi.fn();
    useAppStore.setState({ showToast });
    const onShowVersion = vi.fn();
    const handlers = renderViewer([photo(2, { derived_from_id: 1, ai_kind: "colour" })], { onShowVersion });
    const bar = await screen.findByRole("region", { name: "Choose what to keep" });
    expect(bar).toHaveTextContent("Improved automatically. Which do you want to keep?");
    fireEvent.click(within(bar).getByRole("button", { name: label }));
    await waitFor(() => expect(handlers.onLibraryChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/api/restore/choices")?.body).toEqual({ photo_ids: [2], choice });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining(message), "success");
    if (keepId === 2) expect(onShowVersion).not.toHaveBeenCalled();
    else expect(onShowVersion).toHaveBeenCalledWith(1); // The improved one went to Trash: show the original.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Choose what to keep" })).not.toBeInTheDocument());
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
