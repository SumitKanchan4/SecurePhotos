import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/useAppStore";
import type { MusicTrackItem, StoryModel, SuggestedCollage } from "../../types";
import { StoriesView } from "../StoriesView";
import { MusicLibrary } from "../settings/MusicSettings";
import { filterTracks, moodLabel, storyMeta, storySpan } from "./storiesFormat";

const story = (id: number, title: string, extra: Partial<StoryModel> = {}): StoryModel => ({
  id,
  title,
  story_type: "vacation_adventure",
  vibe_mood: "upbeat",
  music_track_path: "",
  cover_photo_id: id * 10,
  slides_count: 86,
  first_taken_at: "2026-11-08 09:00:00",
  last_taken_at: "2026-11-12 18:00:00",
  slides: [],
  ...extra,
});

const GOA = story(1, "Goa, Nov 2026");
const ASHA = story(2, "Through the years: Asha", { first_taken_at: "2019-01-01", last_taken_at: "2026-06-01", slides_count: 40 });
const KERALA = story(3, "Kerala road trip", { is_saved: true, first_taken_at: "2025-01-03", last_taken_at: "2025-01-09", slides_count: 210 });
const IDEA: SuggestedCollage = {
  id: "c1",
  title: "Goa sunsets",
  subtitle: "4 photos · Nov 2026",
  cluster_type: "event",
  layout: "mosaic",
  photo_ids: [11, 12, 13, 14],
  preview_photo_ids: [11, 12, 13, 14],
  is_already_saved: false,
};
const TRACK: MusicTrackItem = {
  id: "t1",
  filename: "sunny.mp3",
  title: "Sunny Days",
  artist: "Band",
  mood: "auto",
  detected_mood: "upbeat",
  auto_tagged: true,
  duration_seconds: 120,
  duration_formatted: "2:00",
  file_size_bytes: 1,
  file_size_formatted: "1 KB",
  stream_url: "/api/stories/music/t1/stream",
};

type Call = { url: string; init?: RequestInit };
let calls: Call[];

function mockEngine(routes: Record<string, unknown | (() => unknown)>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = `${init?.method ?? "GET"} ${url.replace("http://127.0.0.1:50123", "")}`;
      const route = routes[key];
      const body = typeof route === "function" ? (route as () => unknown)() : route;
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }),
  );
}

const sent = (suffix: string, method: string) => calls.filter((c) => c.url.endsWith(suffix) && c.init?.method === method);

beforeEach(() => {
  useAppStore.setState({ apiBaseUrl: "http://127.0.0.1:50123", apiToken: "t", showToast: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stories helpers", () => {
  it("says when a story happened and how many photos it has", () => {
    expect(storySpan("2026-11-08", "2026-11-12")).toBe("Nov 2026");
    expect(storySpan("2025-11-12 10:00:00", "2025-11-12 18:00:00")).toBe("12 Nov 2025");
    expect(storySpan("2025-10-01", "2025-12-30")).toBe("Oct – Dec 2025");
    expect(storySpan("2019-01-01", "2026-06-01")).toBe("2019 – 2026");
    expect(storySpan(null, null)).toBe("");
    expect(storyMeta(GOA)).toBe("Nov 2026 · 86 photos");
    expect(storyMeta({ slides_count: 0 })).toBe("");
    expect(moodLabel(TRACK)).toBe("Picked for me: Upbeat");
    expect(moodLabel({ ...TRACK, detected_mood: null })).toBe("Pick for me");
    expect(moodLabel({ ...TRACK, mood: "cinematic" })).toBe("Cinematic");
    expect(filterTracks([TRACK], "upb")).toHaveLength(1);
    expect(filterTracks([TRACK], "jazz")).toHaveLength(0);
  });
});

describe("StoriesView", () => {
  const routes = {
    "GET /api/stories?ephemeral_only=true": [GOA, ASHA],
    "GET /api/stories?saved_only=true": [KERALA],
    "GET /api/creatives/suggestions": { suggestions: [IDEA] },
    "PATCH /api/stories/1/save": { ...GOA, is_saved: true },
    "PATCH /api/stories/3/save": { ...KERALA, is_saved: false },
    "DELETE /api/stories/2": { status: "deleted" },
    "POST /api/creatives/suggestions/save": { photo_id: 99 },
  };

  it("plays the newest story on a stage, more as tagged cards, Saved below, collage ideas last (round 2, #8)", async () => {
    mockEngine(routes);
    const onPlay = vi.fn();
    render(<StoriesView onPlayStory={onPlay} onNavigate={vi.fn()} />);
    expect(await screen.findByText("3 stories")).toBeInTheDocument();
    const stage = screen.getByRole("region", { name: "Newest story: Goa, Nov 2026" });
    expect(within(stage).getByRole("heading", { name: "Goa, Nov 2026" })).toBeInTheDocument();
    expect(within(stage).getByText("Trip")).toBeInTheDocument();
    fireEvent.click(within(stage).getByRole("button", { name: "Play story" }));
    expect(onPlay).toHaveBeenCalledWith(1);
    const more = screen.getByRole("region", { name: "More for you" });
    expect(within(more).getByRole("button", { name: "Play Through the years: Asha, 2019 – 2026 · 40 photos" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Saved" })).getByText("Kerala road trip")).toBeInTheDocument();
    expect(await screen.findByText("Goa sunsets")).toBeInTheDocument();
  });

  it("saving moves a story to Saved, unsaving moves it back, hiding removes it", async () => {
    mockEngine(routes);
    const changed = vi.fn();
    window.addEventListener("stories-changed", changed);
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    await screen.findByText("3 stories");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Goa, Nov 2026" }));
    });
    expect(JSON.parse(String(sent("/api/stories/1/save", "PATCH")[0].init?.body))).toEqual({ is_saved: true });
    expect(within(screen.getByRole("region", { name: "Saved" })).getByText("Goa, Nov 2026")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Newest story: Goa, Nov 2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Newest story: Through the years: Asha" })).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unsave Kerala road trip" }));
    });
    expect(screen.getByRole("region", { name: "Newest story: Kerala road trip" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide Through the years: Asha" }));
    });
    expect(sent("/api/stories/2", "DELETE")).toHaveLength(1);
    expect(screen.queryByText("Through the years: Asha")).not.toBeInTheDocument();
    window.removeEventListener("stories-changed", changed);
  });

  it("Make new stories doesn't put saved stories back under For you", async () => {
    let fresh = [GOA];
    mockEngine({
      ...routes,
      "GET /api/stories?ephemeral_only=true": () => fresh,
      "POST /api/stories/generate": () => {
        fresh = [story(5, "One year ago"), GOA];
        return [KERALA, ...fresh]; // the engine answers with every story, saved ones included
      },
    });
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    await screen.findByText("2 stories");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make new stories" }));
    });
    expect(screen.getByRole("region", { name: "Newest story: One year ago" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "More for you" })).queryByText("Kerala road trip")).not.toBeInTheDocument();
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith("Made 1 new story.", "success");
  });

  it("welcomes a library with no stories yet and makes the first ones", async () => {
    let fresh: StoryModel[] = [];
    mockEngine({
      ...routes,
      "GET /api/stories?ephemeral_only=true": () => fresh,
      "GET /api/stories?saved_only=true": [],
      "POST /api/stories/generate": () => {
        fresh = [GOA];
        return fresh;
      },
    });
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    const welcome = await screen.findByRole("region", { name: "Your photos, told as stories" });
    expect(screen.queryByRole("region", { name: "Saved" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(welcome).getByRole("button", { name: "Make my first stories" }));
    });
    expect(screen.getByRole("region", { name: "Newest story: Goa, Nov 2026" })).toBeInTheDocument();
  });

  it("saves a collage idea with one click", async () => {
    mockEngine(routes);
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    const save = await screen.findByRole("button", { name: "Save Goa sunsets" });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(JSON.parse(String(sent("/api/creatives/suggestions/save", "POST")[0].init?.body))).toEqual({
      suggestion_id: "c1",
      photo_ids: [11, 12, 13, 14],
      layout: "mosaic",
      title: "Goa sunsets",
    });
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("says why a collage can't be made when its photos are missing", async () => {
    mockEngine(routes);
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url).replace("http://127.0.0.1:50123", "");
      if (path === "/api/creatives/suggestions/save") return new Response(JSON.stringify({ detail: "At least 2 valid source photo files on disk are required." }), { status: 400 });
      const body = (routes as Record<string, unknown>)[`${init?.method ?? "GET"} ${path}`];
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    });
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    const save = await screen.findByRole("button", { name: "Save Goa sunsets" });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(useAppStore.getState().showToast).toHaveBeenCalledWith(
      "Goa sunsets couldn't be made: some of its photos aren't on this computer (a moved folder or an unplugged drive).",
      "warning",
    );
    expect(screen.getByRole("button", { name: "Save Goa sunsets" })).toBeInTheDocument();
  });
});

describe("StoriesView collage ideas", () => {
  it("shows six ideas first and more on request", async () => {
    const ideas = Array.from({ length: 20 }, (_, i) => ({ ...IDEA, id: `c${i}`, title: `Idea ${i + 1}` }));
    mockEngine({ "GET /api/stories?ephemeral_only=true": [], "GET /api/stories?saved_only=true": [], "GET /api/creatives/suggestions": { suggestions: ideas } });
    render(<StoriesView onPlayStory={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Idea 6")).toBeInTheDocument();
    expect(screen.queryByText("Idea 7")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more ideas (14 more)" }));
    expect(screen.getByText("Idea 18")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more ideas (2 more)" }));
    expect(screen.getByText("Idea 20")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show more ideas/ })).not.toBeInTheDocument();
  });
});

describe("Settings → Music (round 2, #6)", () => {
  it("lists songs, changes a mood and asks before removing one", async () => {
    mockEngine({
      "GET /api/stories/music": [TRACK],
      "PATCH /api/stories/music/t1": { ...TRACK, mood: "nostalgic" },
      "DELETE /api/stories/music/t1": { status: "deleted" },
    });
    render(<MusicLibrary />);
    expect(await screen.findByText("Band · 2:00 · Picked for me: Upbeat")).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Mood for Sunny Days" }), { target: { value: "nostalgic" } });
    });
    expect(JSON.parse(String(sent("/api/stories/music/t1", "PATCH")[0].init?.body))).toEqual({ mood: "nostalgic" });
    expect(screen.getByText("Band · 2:00 · Nostalgic")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Sunny Days" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Remove Sunny Days?" })).getByRole("button", { name: "Cancel" }));
    expect(sent("/api/stories/music/t1", "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove Sunny Days" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove song" }));
    });
    expect(sent("/api/stories/music/t1", "DELETE")).toHaveLength(1);
    expect(await screen.findByText("No songs yet")).toBeInTheDocument();
  });
});
