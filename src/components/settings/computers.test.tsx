import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { ComputersSettings } from "./ComputersSettings";
import { NewComputerDialog } from "../NewComputerDialog";
import { choiceMeaning, lastUsed, lastUsedLine } from "./computersFormat";
import type { ComputersResponse } from "../../services/computers";

type Call = { key: string; body?: unknown };
let calls: Call[];

function yesterdayUtc(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function listing(overrides: Partial<ComputersResponse["this_computer"]> = {}): ComputersResponse {
  return {
    this_computer: { id: "b", name: "FRIEND-LAPTOP", choice: null, does_work_now: false, needs_answer: false, ...overrides },
    computers: [
      { id: "b", name: "FRIEND-LAPTOP", choice: "view", first_seen: null, last_seen: "2026-11-21 08:00:00", is_this: true },
      // Yesterday, from today's date (a fixed date stopped being "yesterday" the next day).
      { id: "a", name: "HOME-PC", choice: "always", first_seen: null, last_seen: yesterdayUtc(), is_this: false },
    ],
  };
}

function mockEngine(responses: Record<string, ComputersResponse>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "")}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(responses[key] ?? listing()), { status: 200 });
    }),
  );
}

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn(), isEngineReady: true });
});

afterEach(() => vi.unstubAllGlobals());

describe("Your computers (Settings → Storage)", () => {
  it("lists every computer with its choice and marks this one", async () => {
    mockEngine({});
    render(<ComputersSettings />);
    const friend = await screen.findByRole("radiogroup", { name: "What FRIEND-LAPTOP does" });
    expect(within(friend).getByRole("radio", { name: "Only views" })).toHaveAttribute("aria-checked", "true");
    const home = screen.getByRole("radiogroup", { name: "What HOME-PC does" });
    expect(within(home).getByRole("radio", { name: "Always does the work" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("This computer")).toBeInTheDocument();
    // One tile each; the one in use is outlined and says what its choice means.
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveClass("is-this", "is-view");
    expect(within(tiles[0]).getByText("Only for viewing. Improving waits for one of your other computers.")).toBeInTheDocument();
    expect(within(tiles[1]).getByText("Last used yesterday", { exact: false })).toBeInTheDocument();
    // Forget is offered for the other computers, not the one in use.
    expect(screen.getByRole("button", { name: "Forget HOME-PC" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forget FRIEND-LAPTOP" })).not.toBeInTheDocument();
  });

  it("offers the same three choices as the question, and saves a change", async () => {
    mockEngine({});
    render(<ComputersSettings />);
    const friend = await screen.findByRole("radiogroup", { name: "What FRIEND-LAPTOP does" });
    expect(within(friend).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Always does the work",
      "Asks each time",
      "Only views",
    ]);
    await act(async () => fireEvent.click(within(friend).getByRole("radio", { name: "Asks each time" })));
    expect(calls).toContainEqual({ key: "PUT /api/computers/b", body: { choice: "ask" } });
  });

  it("forgets another computer", async () => {
    mockEngine({});
    render(<ComputersSettings />);
    const forget = await screen.findByRole("button", { name: "Forget HOME-PC" });
    await act(async () => fireEvent.click(forget));
    expect(calls.map((c) => c.key)).toContain("DELETE /api/computers/a");
  });
});

describe("The question on a new computer", () => {
  it("asks once, with the three answers, and saves the one chosen", async () => {
    mockEngine({ "GET /api/computers": listing({ needs_answer: true }) });
    render(<NewComputerDialog />);
    const dialog = await screen.findByRole("dialog", { name: "Improve your photos on this computer too?" });
    expect(within(dialog).getByText("FRIEND-LAPTOP")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Yes, and remember this computer",
      "Just this time",
      "No, only view here",
    ]);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Just this time" })));
    expect(calls).toContainEqual({ key: "POST /api/computers/this/answer", body: { answer: "this_time" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays away on a computer that already has its answer", async () => {
    mockEngine({ "GET /api/computers": listing({ needs_answer: false }) });
    render(<NewComputerDialog />);
    await act(async () => {});
    expect(calls.map((c) => c.key)).toEqual(["GET /api/computers"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("waits for the engine before asking", async () => {
    useAppStore.setState({ isEngineReady: false });
    mockEngine({ "GET /api/computers": listing({ needs_answer: true }) });
    render(<NewComputerDialog />);
    await act(async () => {});
    expect(calls).toEqual([]);
  });
});

describe("computer wording", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  it("says when a computer was last used", () => {
    expect(lastUsed("2026-11-21 09:00:00", now)).toBe("today");
    expect(lastUsed("2026-11-20 09:00:00", now)).toBe("yesterday");
    expect(lastUsed("2026-11-02 09:00:00", now)).toBe("2 Nov 2026");
    expect(lastUsed(null, now)).toBe("some time ago");
  });
  it("explains each choice in plain words", () => {
    expect(choiceMeaning("always")).toBe("Improves your photos whenever your drive is plugged in.");
    expect(choiceMeaning("ask")).toBe("Asks whether to improve photos each time your drive is plugged in.");
    expect(choiceMeaning("view")).toBe("Only for viewing. Improving waits for one of your other computers.");
    expect(lastUsedLine("2026-11-20 09:00:00", true, now)).toBe("In use now");
    expect(lastUsedLine("2026-11-20 09:00:00", false, now)).toBe("Last used yesterday");
  });
});

describe("drive wording", () => {
  it("names the drive, says what kind it is and splits it in three", async () => {
    const { driveKind, driveName, driveParts, percentLabel } = await import("./storageFormat");
    expect(driveName({ drive_letter: "E:\\", volume_name: "Photos" })).toBe("Photos (E:)");
    expect(driveName({ drive_letter: "F:", volume_name: "" })).toBe("Drive F:");
    expect(driveKind({ is_internal: true })).toBe("This computer's own drive");
    const parts = driveParts({
      drive_letter: "E:", volume_name: "", drive_type: "removable", is_internal: false, disclaimer: "",
      total_bytes: 100, free_bytes: 60, app_consumed_bytes: 10, system_other_bytes: 0, other_files_bytes: 0,
    });
    expect(parts.map((p) => [p.key, p.bytes, p.percent])).toEqual([["app", 10, 10], ["other", 30, 30], ["free", 60, 60]]);
    expect(percentLabel(0.4)).toBe("<1%");
    expect(driveParts(null)).toEqual([]);
  });
});
