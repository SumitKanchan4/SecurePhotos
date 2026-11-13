import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import { DEFAULT_SETTINGS } from "../../hooks/useAppSettings";
import { SETTINGS_SECTIONS, SettingsView } from "../SettingsView";
import { VaultSettings } from "./VaultSettings";
import { PhotosAISettings, qualityTier } from "./PhotosAISettings";
import { StorageSettings } from "./StorageSettings";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("../../utils/gridCardRenderer", () => ({
  renderGridCardCanvas: vi.fn(),
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
  it("lists the five sections on the left and opens one at a time", () => {
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
    expect(screen.getByRole("switch", { name: "Thermal and battery guard" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ambient story soundtracks" })).toBeInTheDocument();
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
  it("names the photo quality in plain words", () => {
    expect(qualityTier(14).label).toBe("Best quality");
    expect(qualityTier(18).label).toBe("Balanced (Recommended)");
    expect(qualityTier(22).label).toBe("Smaller files");
    expect(qualityTier(28).label).toBe("Smallest files");
    const updateSetting = vi.fn();
    render(<PhotosAISettings settings={DEFAULT_SETTINGS} updateSetting={updateSetting} />);
    expect(screen.getByText("Balanced (Recommended)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Photo quality"), { target: { value: "25" } });
    expect(updateSetting).toHaveBeenCalledWith("quality_crf", 25);
  });

  it("shows where the library lives and how much space it uses", async () => {
    invokeMock.mockResolvedValue({ path: "D:/SecurePhotos Library", is_custom: true, has_database: true });
    mockEngine({
      "GET /api/system/dashboard": {
        body: {
          media_counts: {},
          app_storage: { total_bytes: 5 * 1024 ** 3, media_bytes: 4.5 * 1024 ** 3, app_system_bytes: 512 * 1024 ** 2 },
          drive_storage: { drive_letter: "D:", volume_name: "Photos", total_bytes: 1000 * 1024 ** 3, free_bytes: 600 * 1024 ** 3 },
        },
      },
    });
    render(<StorageSettings />);
    expect(await screen.findByText("D:/SecurePhotos Library")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Photos and videos 4.5 GB · app data 512 MB")).toBeInTheDocument());
    expect(screen.getByText("Free on Photos")).toBeInTheDocument();
    expect(screen.getByText("600.0 GB")).toBeInTheDocument();
  });
});
