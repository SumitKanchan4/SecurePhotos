/**
 * T31: getting to know a computer (new-computer step 2) and the graphics card in Settings.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { NewComputerDialog } from "../NewComputerDialog";
import { ComputersSettings } from "./ComputersSettings";
import { graphicsLine, jobRow, memoryLine, otherComputerGraphics, processorLine, readyText, testingLine } from "./hardwareFormat";
import { graphicsAbout } from "./AboutSettings";
import type { Hardware } from "../../services/computers";

const CARD = { name: "AMD Radeon 860M", driver: "32.0.22050.1003", memory_mb: 512 };
const DONE_JOBS: Hardware["jobs"] = [
  { job: "faces", device: "gpu", speedup: 3.9, why: null },
  { job: "colour", device: "cpu", speedup: null, why: "not faster on the graphics card" },
  { job: "scratches", device: "mixed", speedup: null, why: "can't run on the graphics card" },
];

function hardware(overrides: Partial<Hardware> = {}): Hardware {
  return {
    memory_gb: 16, memory_low: false, cpu: "AMD Ryzen AI 5 340", cores: 6, gpu: CARD, use_graphics: true, tested_at: null,
    needs_test: true, jobs: [], test: { state: "idle", step: null, job: null, progress: 0, error: null }, ...overrides,
  };
}

const listing = (choice: string | null = null) => ({
  this_computer: { id: "b", name: "SUMIT-LAPTOP", choice, does_work_now: false, needs_answer: true },
  computers: [
    { id: "b", name: "SUMIT-LAPTOP", choice: "always", first_seen: null, last_seen: null, is_this: true },
    { id: "a", name: "HOME-PC", choice: "always", first_seen: null, last_seen: null, is_this: false, graphics: { gpu: "AMD Radeon(TM) Graphics", jobs_on_gpu: ["faces", "print"], use_graphics: true } },
  ],
});

let calls: string[];

function mockEngine(route: (key: string) => unknown) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "")}`;
      calls.push(key);
      return new Response(JSON.stringify(route(key)), { status: 200 });
    }),
  );
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn(), isEngineReady: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("graphics card words (T31)", () => {
  it("says what this computer has and what runs where, in plain words", () => {
    expect(memoryLine({ memory_gb: 16, memory_low: false })).toBe("16 GB, plenty for old-photo fixes");
    expect(memoryLine({ memory_gb: 4, memory_low: true })).toBe("4 GB: old-photo fixes may be slow here");
    expect(processorLine({ cpu: "AMD Ryzen AI 5 340", cores: 6 })).toBe("AMD Ryzen AI 5 340 · 6 cores");
    expect(graphicsLine({ gpu: null })).toBe("None SecurePhotos can use");
    expect(jobRow(DONE_JOBS[0])).toEqual({ label: "Sharpening faces", where: "Graphics card", note: "4× faster", fast: true });
    expect(jobRow(DONE_JOBS[1])).toEqual({ label: "Adding colour", where: "Processor", note: "best here", fast: false });
    expect(jobRow(DONE_JOBS[2]).where).toBe("Partly on the graphics card");
    expect(testingLine(hardware({ test: { state: "running", step: "testing", job: "colour", progress: 40, error: null } }))).toBe(
      "Trying adding colour on the graphics card…",
    );
    expect(readyText(hardware({ jobs: DONE_JOBS }))).toMatch(/^The AMD Radeon 860M graphics card makes some photo fixes much faster here/);
    expect(readyText(hardware({ gpu: null }))).toMatch(/^It has no graphics card SecurePhotos can use/);
    expect(readyText(hardware({ jobs: [DONE_JOBS[1]] }))).toMatch(/isn't faster than the processor/);
    expect(otherComputerGraphics({ gpu: "Intel UHD 620", jobs_on_gpu: [], use_graphics: true })).toBe("Intel UHD 620 · not faster than the processor");
    expect(graphicsAbout(hardware({ needs_test: false, jobs: DONE_JOBS }))).toBe("AMD Radeon 860M · driver 32.0.22050.1003 · used for 2 kinds of work");
    expect(graphicsAbout(hardware({ gpu: null }))).toMatch(/^None SecurePhotos can use here/);
  });
});

describe("Getting to know this computer (new-computer step 2)", () => {
  it("after Yes it checks the computer, times each job, then says what runs where", async () => {
    let state: Hardware = hardware();
    mockEngine((key) => {
      if (key === "GET /api/computers") return listing(null);
      if (key === "POST /api/computers/this/answer") return listing("always");
      if (key === "POST /api/computers/this/hardware/test") {
        state = hardware({ test: { state: "running", step: "testing", job: "faces", progress: 10, error: null } });
      }
      return state;
    });
    render(<NewComputerDialog />);
    const ask = await screen.findByRole("dialog", { name: "Improve your photos on this computer too?" });
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Yes, and remember this computer" })));
    const check = await screen.findByRole("dialog", { name: "Getting to know this computer" });
    expect(within(check).getByText("Step 2 of 2")).toBeInTheDocument();
    expect(within(check).getByText("16 GB, plenty for old-photo fixes")).toBeInTheDocument();
    expect(within(check).getByText("AMD Radeon 860M")).toBeInTheDocument();
    expect(within(check).getByText("Trying sharpening faces on the graphics card…")).toBeInTheDocument();
    expect(calls).toContain("POST /api/computers/this/hardware/test");
    state = hardware({ needs_test: false, jobs: DONE_JOBS, test: { state: "done", step: "done", job: null, progress: 100, error: null } });
    const ready = await screen.findByRole("dialog", { name: "This computer is ready" }, { timeout: 3000 });
    expect(within(ready).getByText("4× faster")).toBeInTheDocument();
    expect(within(ready).getByText("Partly on the graphics card")).toBeInTheDocument();
    fireEvent.click(within(ready).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Skip for now stops the test and closes", async () => {
    mockEngine((key) => {
      if (key === "GET /api/computers") return listing(null);
      if (key === "POST /api/computers/this/answer") return listing("ask");
      return hardware({ test: { state: "running", step: "testing", job: "print", progress: 30, error: null } });
    });
    render(<NewComputerDialog />);
    const ask = await screen.findByRole("dialog", { name: "Improve your photos on this computer too?" });
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Just this time" })));
    const check = await screen.findByRole("dialog", { name: "Getting to know this computer" });
    await act(async () => fireEvent.click(within(check).getByRole("button", { name: "Skip for now" })));
    expect(calls).toContain("POST /api/computers/this/hardware/test/cancel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a new computer without a usable card is ready at once, calmly", async () => {
    mockEngine((key) => {
      if (key === "GET /api/computers") return listing(null);
      if (key === "POST /api/computers/this/answer") return listing("always");
      return hardware({ gpu: null, needs_test: false });
    });
    render(<NewComputerDialog />);
    const ask = await screen.findByRole("dialog", { name: "Improve your photos on this computer too?" });
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Yes, and remember this computer" })));
    const ready = await screen.findByRole("dialog", { name: "This computer is ready" });
    expect(within(ready).getByText(/no graphics card SecurePhotos can use/)).toBeInTheDocument();
    expect(within(ready).getByText("None SecurePhotos can use")).toBeInTheDocument();
    expect(calls).not.toContain("POST /api/computers/this/hardware/test");
  });

  it("a computer already measured goes straight on, with no second step", async () => {
    mockEngine((key) => {
      if (key === "GET /api/computers") return listing("ask");
      if (key === "POST /api/computers/this/answer") return listing("ask");
      return hardware({ needs_test: false, jobs: DONE_JOBS });
    });
    render(<NewComputerDialog />);
    const ask = await screen.findByRole("dialog", { name: "Improve your photos on this computer too?" });
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Just this time" })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Settings: this computer's graphics card", () => {
  it("shows what runs where, turns the card off, and tests again", async () => {
    let state = hardware({ needs_test: false, jobs: DONE_JOBS });
    mockEngine((key) => {
      if (key === "GET /api/computers") return { ...listing("always"), this_computer: { ...listing("always").this_computer, needs_answer: false } };
      if (key === "PUT /api/computers/this/graphics") state = { ...state, use_graphics: false };
      if (key === "POST /api/computers/this/hardware/test") state = { ...state, test: { state: "running", step: "testing", job: "faces", progress: 5, error: null } };
      return state;
    });
    render(<ComputersSettings />);
    expect(await screen.findByText("Graphics card: AMD Radeon 860M")).toBeInTheDocument();
    expect(screen.getByText("Graphics card · 4× faster")).toBeInTheDocument();
    expect(screen.getByText("Graphics card: AMD Radeon(TM) Graphics · sharpening faces, 8k print copies on the card")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Use the graphics card on this computer" })));
    expect(calls).toContain("PUT /api/computers/this/graphics");
    expect(screen.getByRole("switch", { name: "Use the graphics card on this computer" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Test again" }));
    // Loading, then running: both show this heading, as different elements; wait for it, don't hold one.
    await waitFor(() => expect(screen.getByText("Getting to know this computer")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Trying sharpening faces on the graphics card…")).toBeInTheDocument());
  });
});
