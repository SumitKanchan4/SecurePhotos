import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { IconRail, RAIL_ITEMS, railStatus } from "./IconRail";
import { WindowStrip } from "./WindowStrip";

const windowApi = vi.hoisted(() => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowApi }));

beforeEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState({
    activeTab: "photos",
    searchQuery: "",
    searchFocusKey: 0,
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
    expect(useAppStore.getState().activeTab).toBe("search");
    expect(useAppStore.getState().searchFocusKey).toBe(1);
  });

  it("opens the Search page with Ctrl+K from anywhere and marks it current", () => {
    const { rerender } = render(<IconRail />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(useAppStore.getState().activeTab).toBe("search");
    rerender(<IconRail />);
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Photos" })).not.toHaveAttribute("aria-current");
  });

  it("explains the status dot in plain language", () => {
    expect(railStatus(true, true, false)).toEqual({ tone: "ok", text: "Library ready · engine running" });
    expect(railStatus(false, true, false).tone).toBe("problem");
    expect(railStatus(true, false, true).text).toBe("Engine offline: open Settings to fix");
    expect(railStatus(true, undefined, false).tone).toBe("starting");
  });
});

describe("WindowStrip", () => {
  it("has no search chip: search lives on its own page now", () => {
    act(() => useAppStore.setState({ searchQuery: "Rohan" }));
    render(<WindowStrip />);
    expect(screen.queryByText("Rohan")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
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
