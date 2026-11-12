import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { IconRail, RAIL_ITEMS, railStatus } from "./IconRail";
import { SearchPalette } from "./SearchPalette";
import { WindowStrip } from "./WindowStrip";

const windowApi = vi.hoisted(() => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowApi }));

beforeEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({
    activeTab: "photos",
    searchQuery: "",
    isSearchOpen: false,
    isDriveConnected: true,
    prerequisites: null,
    apiBaseUrl: "http://127.0.0.1:50123",
    apiToken: "token-abc",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IconRail", () => {
  it("shows every section as a labelled icon and marks the current one", () => {
    render(<IconRail />);
    for (const item of RAIL_ITEMS) {
      expect(screen.getByRole("button", { name: item.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Photos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "People" })).not.toHaveAttribute("aria-current");
  });

  it("switches section and opens search", () => {
    render(<IconRail />);
    fireEvent.click(screen.getByRole("button", { name: "Private Vault" }));
    expect(useAppStore.getState().activeTab).toBe("vault");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(useAppStore.getState().isSearchOpen).toBe(true);
  });

  it("explains the status dot in plain language", () => {
    expect(railStatus(true, true, false)).toEqual({ tone: "ok", text: "Library ready · engine running" });
    expect(railStatus(false, true, false).tone).toBe("problem");
    expect(railStatus(true, false, true).text).toBe("Engine offline: open Settings to fix");
    expect(railStatus(true, undefined, false).tone).toBe("starting");
  });
});

describe("WindowStrip", () => {
  it("shows the active search as a chip that can be cleared or edited", () => {
    const { rerender } = render(<WindowStrip />);
    expect(screen.queryByText("Search:")).not.toBeInTheDocument();

    act(() => useAppStore.setState({ searchQuery: "Rohan" }));
    rerender(<WindowStrip />);
    expect(screen.getByText("Rohan")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Edit search (Ctrl+K)"));
    expect(useAppStore.getState().isSearchOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(useAppStore.getState().searchQuery).toBe("");
  });

  it("drives the frameless window buttons", () => {
    render(<WindowStrip />);
    fireEvent.click(screen.getByRole("button", { name: "Minimise window" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximise or restore window" }));
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(windowApi.minimize).toHaveBeenCalledOnce();
    expect(windowApi.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowApi.close).toHaveBeenCalledOnce();
  });
});

describe("SearchPalette", () => {
  it("opens with Ctrl+K and closes with Escape or a click outside", () => {
    render(<SearchPalette />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search your library" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => useAppStore.setState({ isSearchOpen: true }));
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(useAppStore.getState().isSearchOpen).toBe(false);
  });

  it("searches the engine as you type and opens a person from the results", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          query: "ro",
          total_photos: 0,
          photos: [],
          albums: [],
          people: [{ id: 7, name: "Rohan", confirmed_count: 412 }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    act(() => useAppStore.setState({ isSearchOpen: true }));
    render(<SearchPalette />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ro" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:50123/api/search?q=ro");
    expect(new Headers(init.headers).get("X-SecurePhotos-Token")).toBe("token-abc");

    fireEvent.click(screen.getByText("Rohan"));
    expect(useAppStore.getState().activeTab).toBe("people");
    expect(useAppStore.getState().searchQuery).toBe("Rohan");
    expect(useAppStore.getState().isSearchOpen).toBe(false);
  });
});
