import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { useBackgroundProgress } from "./useBackgroundProgress";

let photo = { is_active: true, completed_count: 0, total_count: 3, last_completed_photo_id: null as number | null };
let importing = { is_active: true, completed_count: 1, total_count: 5 };
let restore: unknown = { is_active: false };

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t" });
  photo = { is_active: true, completed_count: 0, total_count: 3, last_completed_photo_id: null };
  importing = { is_active: true, completed_count: 1, total_count: 5 };
  restore = { is_active: false }; // An unexpected answer must not stop the other reports.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/api/photos/optimization-progress")) return new Response(JSON.stringify(photo));
      if (url.endsWith("/api/photos/import-progress")) return new Response(JSON.stringify(importing));
      if (url.endsWith("/api/restore/jobs")) return new Response(JSON.stringify(restore));
      return new Response(JSON.stringify({ is_active: false }));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

describe("useBackgroundProgress", () => {
  it("marks a photo as soon as it is enhanced and reloads once when a batch ends", async () => {
    const onPhotoEnhanced = vi.fn();
    const onBatchFinished = vi.fn();
    const { result } = renderHook(() => useBackgroundProgress({ onPhotoEnhanced, onBatchFinished }));

    await tick();
    expect(result.current.optimizationProgress?.is_active).toBe(true);
    expect(result.current.importProgress?.completed_count).toBe(1);
    expect(onPhotoEnhanced).not.toHaveBeenCalled();

    photo = { ...photo, completed_count: 1, last_completed_photo_id: 42 };
    await tick();
    expect(onPhotoEnhanced).toHaveBeenCalledWith(42);
    expect(onBatchFinished).not.toHaveBeenCalled();

    // The import ends: one reload. The enhancement then ends: one more.
    importing = { ...importing, is_active: false };
    await tick();
    expect(onBatchFinished).toHaveBeenCalledTimes(1);
    photo = { ...photo, is_active: false };
    await tick();
    await tick();
    expect(onBatchFinished).toHaveBeenCalledTimes(2);
  });

  it("reports old-photo jobs and reloads once when an improved copy is kept", async () => {
    const onBatchFinished = vi.fn();
    const report = (done: number) => ({
      working: [], waiting: [], review: [], paused: false, paused_reason: null, download: null,
      finished_today: Array.from({ length: done }, (_, i) => ({ id: i, photo_id: i, kind: "colour", status: "done", progress: 100, error: null, result_photo_id: 50 + i })),
    });
    restore = report(1);
    photo = { ...photo, is_active: false };
    importing = { ...importing, is_active: false };
    const { result } = renderHook(() => useBackgroundProgress({ onPhotoEnhanced: vi.fn(), onBatchFinished }));
    await tick();
    expect(result.current.restoreJobs?.finished_today).toHaveLength(1);
    expect(onBatchFinished).not.toHaveBeenCalled(); // Already kept before the app looked: no reload.
    restore = report(2);
    await tick();
    expect(onBatchFinished).toHaveBeenCalledTimes(1);
    await tick();
    expect(onBatchFinished).toHaveBeenCalledTimes(1);
  });
});
