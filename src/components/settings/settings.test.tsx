import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { DEFAULT_SETTINGS } from "../../hooks/useAppSettings";
import { SETTINGS_SECTIONS, SettingsView } from "../SettingsView";
import { VaultSettings } from "./VaultSettings";
import { PhotosAISettings, batteryChoice, qualityChoice } from "./PhotosAISettings";
import { StorageSettings } from "./StorageSettings";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("../../utils/gridCardRenderer", () => ({
  renderGridCardCanvas: vi.fn(),
  loadCardIcon: vi.fn(async () => null),
  downloadGridCardImage: vi.fn(async () => {}),
  downloadGridCardText: vi.fn(),
}));

type Call = { url: string; init?: RequestInit };
let calls: Call[];

function mockEngine(routes: Record<string, { status?: number; body: unknown }>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "").split("?")[0]}`;
      const route = routes[key] ?? { body: {} };
      return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
    }),
  );
}

beforeEach(() => {
  invokeMock.mockReset();
  useAppStore.setState({
    apiBaseUrl: "http://127.0.0.1:50123",
    apiToken: "t",
    showToast: vi.fn(),
    isVaultConfigured: true,
    isVaultUnlocked: true,
    hasVaultPin: true,
    checkVaultStatus: vi.fn(async () => {}),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings layout", () => {
  it("lists the sections on the left and opens one at a time", () => {
    mockEngine({ "GET /api/system/settings": { body: { settings: DEFAULT_SETTINGS } } });
    invokeMock.mockResolvedValue({ path: "D:/Library", is_custom: true, has_database: true });
    render(<SettingsView />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(Array.from(nav.querySelectorAll("button")).map((b) => b.textContent)).toEqual(SETTINGS_SECTIONS.map((s) => s.label));
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Private Vault" }));
    expect(screen.getByRole("button", { name: "Private Vault" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Lock automatically after")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Photos & AI" }));
    expect(screen.getByRole("radiogroup", { name: "Pause background work on battery" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /music/i })).not.toBeInTheDocument();
    // Music has its own section (round 2, #6).
    fireEvent.click(screen.getByRole("button", { name: "Music" }));
    expect(screen.getByRole("switch", { name: "Play music in stories" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Songs" })).toBeInTheDocument();
  });

  it("opens the section another screen asks for (Stories' music button)", () => {
    mockEngine({ "GET /api/system/settings": { body: { settings: DEFAULT_SETTINGS } } });
    useAppStore.getState().openSettings("music");
    render(<SettingsView />);
    expect(screen.getByRole("heading", { level: 2, name: "Music" })).toBeInTheDocument();
    expect(useAppStore.getState().settingsSection).toBeNull();
  });
});

describe("Private Vault settings", () => {
  const renderVault = () => {
    const updateSetting = vi.fn();
    render(<VaultSettings settings={{ ...DEFAULT_SETTINGS, auto_lock_duration: 300 }} updateSetting={updateSetting} />);
    return updateSetting;
  };

  it("chooses the auto-lock time with pills", () => {
    mockEngine({});
    const updateSetting = renderVault();
    const group = screen.getByRole("radiogroup", { name: "Lock automatically after" });
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["1 min", "5 min", "15 min", "30 min"]);
    expect(screen.getByRole("radio", { name: "5 min" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "15 min" }));
    expect(updateSetting).toHaveBeenCalledWith("auto_lock_duration", 900);
  });

  it("needs an open vault for a new card", () => {
    mockEngine({});
    useAppStore.setState({ isVaultUnlocked: false });
    renderVault();
    expect(screen.getByRole("button", { name: "Print a new card" })).toBeDisabled();
    expect(screen.getByText(/Resets a forgotten password.*Unlock your vault first\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("New quick PIN")).not.toBeInTheDocument();
  });

  it("makes a new Emergency Card only with the right password, and shows it once", async () => {
    mockEngine({
      "POST /api/vault/grid-card/replace": { body: { status: "replaced", grid_card: { card_id: "SP-AB12-CD34", cells: {}, card_token: "x", grid_salt: "y" } } },
    });
    renderVault();
    fireEvent.click(screen.getByRole("button", { name: "Print a new card" }));
    expect(screen.getByText(/Your current card will stop working/)).toBeInTheDocument();
    const make = screen.getByRole("button", { name: "Make new card" });
    expect(make).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "Secret#2026" } });
    await act(async () => {
      fireEvent.click(make);
    });
    const post = calls.find((c) => c.url.endsWith("/api/vault/grid-card/replace"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ current_password: "Secret#2026" });
    expect(screen.getByRole("heading", { name: "Your new Emergency Card" })).toBeInTheDocument();
    expect(screen.getByLabelText("Emergency Card SP-AB12-CD34")).toBeInTheDocument();

    // Done before saving asks first.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Your new Emergency Card" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Save text copy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Your new Emergency Card" })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("explains a wrong password", async () => {
    mockEngine({ "POST /api/vault/grid-card/replace": { status: 401, body: { detail: "Incorrect master password." } } });
    renderVault();
    fireEvent.click(screen.getByRole("button", { name: "Print a new card" }));
    fireEvent.change(screen.getByLabelText("Master password"), { target: { value: "nope" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make new card" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Incorrect master password.");
  });

  it("keeps Erase the vault in a separate danger zone", () => {
    mockEngine({});
    renderVault();
    expect(screen.getByRole("heading", { name: "Danger zone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erase the vault" })).toBeEnabled();
  });
});

describe("Photos & AI and Storage", () => {
  it("offers photo quality as three plain choices (round 2, #7)", () => {
    expect([12, 14, 15].map(qualityChoice)).toEqual([14, 14, 14]);
    expect([16, 18, 20].map(qualityChoice)).toEqual([18, 18, 18]);
    expect([22, 28].map(qualityChoice)).toEqual([24, 24]);
    const updateSetting = vi.fn();
    render(<PhotosAISettings settings={DEFAULT_SETTINGS} updateSetting={updateSetting} />);
    const group = screen.getByRole("radiogroup", { name: "Photo quality" });
    expect(within(group).getByRole("radio", { name: "Balanced" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Looks the same as the original/)).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: "Smaller" }));
    expect(updateSetting).toHaveBeenCalledWith("quality_crf", 24);
    // Photo size and Video size, separate, as pills like the rest (2026-11-19).
    const size = screen.getByRole("radiogroup", { name: "Photo size" });
    expect(within(size).getByRole("radio", { name: "8K" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(size).getByRole("radio", { name: "4K" }));
    expect(updateSetting).toHaveBeenCalledWith("photo_resolution", "4k");
    const video = screen.getByRole("radiogroup", { name: "Video size" });
    expect(within(video).getAllByRole("radio").map((r) => r.textContent)).toEqual(["As recorded", "HD", "2K", "4K"]);
    expect(within(video).getByRole("radio", { name: "HD" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(video).getByRole("radio", { name: "4K" }));
    expect(updateSetting).toHaveBeenCalledWith("video_resolution", "4k");
    // Every row as in Appearance: text left, choices right (owner feedback 2026-11-19).
    expect(document.querySelectorAll(".settings-row.is-stacked")).toHaveLength(0);
  });

  it("pauses background work only below the chosen battery level", () => {
    const updateSetting = vi.fn();
    render(<PhotosAISettings settings={DEFAULT_SETTINGS} updateSetting={updateSetting} />);
    const group = screen.getByRole("radiogroup", { name: "Pause background work on battery" });
    expect(within(group).getByRole("radio", { name: "Below 20%" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group).getByRole("radio", { name: "Never" }));
    expect(updateSetting).toHaveBeenCalledWith("pause_on_battery", false);
    expect(updateSetting).not.toHaveBeenCalledWith("battery_pause_below", 0);
    updateSetting.mockClear();
    fireEvent.click(within(group).getByRole("radio", { name: "Always" }));
    expect(updateSetting).toHaveBeenCalledWith("pause_on_battery", true);
    expect(updateSetting).toHaveBeenCalledWith("battery_pause_below", 100);
    expect(batteryChoice({ pause_on_battery: false, battery_pause_below: 50 })).toBe(0);
    expect(batteryChoice({ pause_on_battery: true, battery_pause_below: 45 })).toBe(50);
    expect(batteryChoice({ pause_on_battery: true, battery_pause_below: 10 })).toBe(20);
  });

  it("has the Old photos rows in plain words, each When I ask or Automatically, and Keep original", () => {
    const updateSetting = vi.fn();
    render(<PhotosAISettings settings={DEFAULT_SETTINGS} updateSetting={updateSetting} />);
    for (const title of ["Add colour to old grey photos", "Fix faded or yellowed colours", "Sharpen blurry faces", "Remove scratches and spots"]) {
      const group = screen.getByRole("radiogroup", { name: title });
      expect(within(group).getByRole("radio", { name: "When I ask" })).toHaveAttribute("aria-checked", "true");
    }
    expect(screen.getByText(/not on photos taken with a phone or camera/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Sharpen blurry faces" })).getByRole("radio", { name: "Automatically" }));
    expect(updateSetting).toHaveBeenCalledWith("old_photos_faces", "auto");
    const keep = screen.getByRole("switch", { name: "Keep original" });
    expect(keep).toBeChecked();
    fireEvent.click(keep);
    expect(updateSetting).toHaveBeenCalledWith("old_photos_keep_original", false);
  });

  it("shows the folder the engine really uses and what the space is used for", async () => {
    // The window program's guess points somewhere else (a dev build looks next to its .exe).
    invokeMock.mockResolvedValue({ path: "C:/somewhere/target/debug/data", is_custom: false, has_database: false });
    mockEngine({
      "GET /api/system/library": { body: { path: "D:/SecurePhotos Library", has_database: true } },
      "GET /api/system/dashboard": {
        body: {
          media_counts: {},
          app_storage: {
            total_bytes: 5 * 1024 ** 3,
            media_bytes: 4.5 * 1024 ** 3,
            app_system_bytes: 512 * 1024 ** 2,
            categories: [
              { key: "photos", bytes: 3 * 1024 ** 3 },
              { key: "videos", bytes: 1.5 * 1024 ** 3 },
              { key: "app", bytes: 512 * 1024 ** 2 },
            ],
          },
          drive_storage: { drive_letter: "D:", volume_name: "Photos", total_bytes: 1000 * 1024 ** 3, free_bytes: 600 * 1024 ** 3 },
        },
      },
    });
    render(<StorageSettings />);
    expect(await screen.findByText("D:/SecurePhotos Library")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByText("No library found here")).not.toBeInTheDocument();
    const usage = await screen.findByRole("list", { name: "What SecurePhotos uses" });
    expect(usage.textContent).toContain("Photos60%3.0 GB");
    expect(usage.textContent).toContain("Videos30%1.5 GB");
    expect(usage.textContent).toContain("App data · database and AI models10%512 MB");
    expect(screen.getByText("Free on Photos")).toBeInTheDocument();
    expect(screen.getByText("600.0 GB")).toBeInTheDocument();
  });

  it("falls back to the window program's answer when the engine can't be asked", async () => {
    invokeMock.mockResolvedValue({ path: "E:/Library", is_custom: true, has_database: true });
    mockEngine({ "GET /api/system/library": { status: 500, body: {} }, "GET /api/system/dashboard": { status: 500, body: {} } });
    render(<StorageSettings />);
    expect(await screen.findByText("E:/Library")).toBeInTheDocument();
  });
});
