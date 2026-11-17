/** H10 / A4: Activity — the model built from engine reports, the page, and the rail's ring. */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { IconRail } from "../shell/IconRail";
import { ActivityView } from "./ActivityView";
import { buildActivity, improvedLabel, type RestoreJobView, type RestoreJobsReport } from "./activityFormat";

const job = (id: number, extra: Partial<RestoreJobView> = {}): RestoreJobView => ({
  id,
  photo_id: 100 + id,
  kind: "colour",
  status: "queued",
  progress: 0,
  error: null,
  result_photo_id: null,
  private: false,
  filename: `old_${id}.jpg`,
  ...extra,
});

const report = (extra: Partial<RestoreJobsReport> = {}): RestoreJobsReport => ({
  working: [],
  waiting: [],
  review: [],
  finished_today: [],
  paused: false,
  paused_reason: null,
  download: null,
  ...extra,
});

describe("buildActivity", () => {
  it("is idle with nothing running", () => {
    const m = buildActivity({});
    expect(m).toMatchObject({ working: [], waiting: [], ready: [], attention: [], remaining: 0, headline: null });
  });

  it("puts every kind of background work in one list and counts what's left", () => {
    const m = buildActivity({
      restore: report({ working: [job(1, { status: "working", progress: 40 })], waiting: [job(2), job(3)] }),
      importing: { is_active: true, total_count: 10, completed_count: 4, current_filename: "a.jpg", album_id: null, album_name: null, imported: 4, skipped: 0 },
      enhance: { is_active: true, active_photo_id: 9, active_filename: "x.jpg", item_progress: 30, completed_count: 1, total_count: 5 },
      video: { is_active: true, total_count: 2, completed_count: 0, item_progress: 10, active_video_id: 55 },
    });
    expect(m.working.map((i) => i.title)).toEqual(["Importing", "Adding colour", "Preparing a video", "Enhancing to 8K"]);
    expect(m.working[1]).toMatchObject({ detail: "old 1", progress: 40, cancel: "job", jobId: 1 });
    // Every card shows what is being worked on.
    expect(m.working[2].photoId).toBe(55);
    expect(m.working[3].photoId).toBe(9);
    // What waits behind the current video and photo is listed too, so the page counts what the ring counts.
    expect(m.waiting.map((i) => [i.key, i.count])).toEqual([["job-2", undefined], ["job-3", undefined], ["video-waiting", 1], ["enhance-waiting", 3]]);
    expect(m.waiting.find((i) => i.key === "enhance-waiting")?.detail).toBe("3 photos");
    expect(m.remaining).toBe(6 + 3 + 2 + 4);
    expect(m.headline).toBe("Importing · 15 items left");
  });

  it("shows a name only when a person wrote it", () => {
    const m = buildActivity({
      restore: report({
        working: [job(1, { status: "working", filename: "1792341321410-1c9bc690-7433-41b8-b05b-6742f8547d2f.avif" })],
        waiting: [job(2, { filename: "Grandma wedding.jpg" })],
      }),
    });
    expect(m.working[0].detail).toBe("");
    expect(m.waiting[0].detail).toBe("Grandma wedding");
  });

  it("never names a vault photo", () => {
    const m = buildActivity({ restore: report({ working: [job(1, { status: "working", private: true, filename: null })] }) });
    expect(m.working[0]).toMatchObject({ detail: "Private photo", private: true });
  });

  it("shows the model download and battery / pause states", () => {
    const m = buildActivity({
      restore: report({ waiting: [job(1)], paused: true, download: { model: "ddcolor_large", done: 5e8, total: 1e9 } }),
      enhance: { is_active: true, active_photo_id: null, active_filename: null, item_progress: 0, completed_count: 2, total_count: 4, paused_reason: "on_battery" },
    });
    expect(m.working[0]).toMatchObject({ kind: "models", progress: 50, detail: "0.5 of 1.0 GB · once only" });
    expect(m.working.find((i) => i.kind === "enhance")?.detail).toBe("3 of 4 · waiting: battery low");
    expect(m.paused).toBe(true);
    expect(m.headline).toBe("Paused · 3 items left");
  });

  it("lists results waiting for a decision, and only finished work that needs the user", () => {
    const m = buildActivity({
      restore: report({
        review: [job(4, { status: "review" })],
        finished_today: [job(5, { status: "done", result_photo_id: 77 }), job(6, { status: "discarded" }), job(7, { status: "failed", error: "models_missing" }), job(8, { kind: "scratches", status: "discarded", error: "nothing_to_fix" })],
      }),
    });
    expect(m.ready[0]).toMatchObject({ title: "Colour added · ready to look at", photoId: 104 });
    expect(m.attention.map((i) => [i.outcome, i.photoId])).toEqual([["Needs a download", 107]]);
    expect(m.headline).toBe("1 photo ready to look at");
    expect(m.remaining).toBe(0);
  });
});

describe("ActivityView", () => {
  beforeEach(() => useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t" }));

  const props = () => ({ onOpenPhoto: vi.fn(), onCancelJob: vi.fn(), onStopImport: vi.fn(), onPauseAll: vi.fn(), onResumeAll: vi.fn() });

  it("says all done when idle", () => {
    render(<ActivityView model={buildActivity({})} {...props()} />);
    expect(screen.getByRole("heading", { name: "All done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause all" })).not.toBeInTheDocument();
  });

  it("shows working, waiting and ready items with their actions; vault photos are locked tiles with no name", () => {
    const handlers = props();
    const model = buildActivity({
      restore: report({
        working: [job(1, { status: "working", progress: 62 })],
        waiting: [job(2, { private: true, filename: null })],
        review: [job(3, { status: "review" })],
      }),
    });
    render(<ActivityView model={model} {...handlers} />);
    expect(screen.getByText("2 to do")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Adding colour" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByLabelText("Private photo")).toBeInTheDocument();
    expect(screen.queryByText("old_2.jpg")).not.toBeInTheDocument();
    expect(screen.queryByText(/Everything runs on this computer/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancelJob).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(handlers.onOpenPhoto).toHaveBeenCalledWith(103);
    fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
    expect(handlers.onPauseAll).toHaveBeenCalled();
  });

  it("shows the photos waiting to be enhanced as one group, and problems under Needs attention", () => {
    const model = buildActivity({
      enhance: { is_active: true, active_photo_id: 9, active_filename: "x.jpg", item_progress: 30, completed_count: 16, total_count: 24 },
      restore: report({ finished_today: [job(7, { status: "failed", error: "models_missing" }), job(8, { status: "done", result_photo_id: 70 })] }),
    });
    render(<ActivityView model={model} {...props()} />);
    expect(screen.getByText("8 to do")).toBeInTheDocument();
    expect(screen.getByText("7 photos")).toBeInTheDocument();
    expect(screen.getByText("Photos to enhance")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Needs attention" })).toHaveTextContent("Needs a download");
    expect(screen.queryByText("Colour added")).not.toBeInTheDocument();
  });

  it("counts photos waiting for 'what to keep' (for the Photos pill) but doesn't ask in Activity", () => {
    const model = buildActivity({
      restore: report({ choices: [{ photo_id: 70, original_id: 7, ai_kind: "colour,faces" }], choices_total: 12 }),
    });
    expect(model.choicesTotal).toBe(12);
    expect(model.headline).toBeNull();
    expect(model.remaining).toBe(0);
    render(<ActivityView model={model} {...props()} />);
    expect(screen.queryByRole("region", { name: /what to keep/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "All done" })).toBeInTheDocument();
    expect(improvedLabel("colour,faces")).toBe("Colour added · faces sharpened");
    expect(improvedLabel("fade")).toBe("Colours fixed");
  });

  it("offers Resume when paused and Stop import for an import", () => {
    const handlers = props();
    const model = buildActivity({
      restore: report({ waiting: [job(1)], paused: true }),
      importing: { is_active: true, total_count: 3, completed_count: 1, current_filename: "", album_id: null, album_name: "Goa", imported: 1, skipped: 0 },
    });
    render(<ActivityView model={model} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(handlers.onResumeAll).toHaveBeenCalled();
    expect(screen.getByText('Adding to "Goa"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop import" }));
    expect(handlers.onStopImport).toHaveBeenCalled();
  });
});

describe("Rail status ring", () => {
  beforeEach(() =>
    useAppStore.setState({ activeTab: "photos", isDriveConnected: true, prerequisites: { backend: { running: true } } as never, activitySummary: null }),
  );

  it("is the plain status dot when nothing runs", () => {
    render(<IconRail />);
    expect(screen.getByTestId("rail-status-dot")).toBeInTheDocument();
    expect(screen.queryByTestId("rail-activity-ring")).not.toBeInTheDocument();
  });

  it("turns into a ring with what's left and opens Activity", () => {
    useAppStore.setState({ activitySummary: { remaining: 12, paused: false, headline: "Adding colour · 12 items left" } });
    render(<IconRail />);
    const ring = screen.getByRole("button", { name: "Activity: Adding colour · 12 items left" });
    expect(screen.getByTestId("rail-activity-ring")).toHaveTextContent("12");
    fireEvent.click(ring);
    expect(useAppStore.getState().activeTab).toBe("activity");
  });

  it("is dashed when paused", () => {
    useAppStore.setState({ activitySummary: { remaining: 3, paused: true, headline: "Paused · 3 items left" } });
    render(<IconRail />);
    expect(screen.getByRole("button", { name: /Activity: Paused/ })).toHaveClass("is-paused");
  });
});
