/**
 * The computers that do the background work (T3). Every computer the drive has been plugged
 * into is listed by the engine with one of three choices; the app asks once on a new computer.
 */
import { apiFetch } from "./api";

export type ComputerChoice = "always" | "ask" | "view";
export type ComputerAnswer = "remember" | "this_time" | "view";

export interface Computer {
  id: string;
  name: string;
  choice: ComputerChoice;
  first_seen: string | null;
  last_seen: string | null;
  is_this: boolean;
  /** T31: that computer's graphics card result, if it was tested. */
  graphics?: { gpu: string; jobs_on_gpu: HardwareJobName[]; use_graphics: boolean } | null;
}

/** T31: the kinds of AI work, as Settings and the new-computer check show them. */
export type HardwareJobName = "faces" | "print" | "colour" | "scratches" | "finding_faces";

export interface HardwareJob {
  job: HardwareJobName;
  device: "gpu" | "cpu" | "mixed";
  speedup: number | null;
  why: string | null;
}

/** T31: this computer's memory, processor, graphics card and what runs where. */
export interface Hardware {
  memory_gb: number;
  memory_low: boolean;
  cpu: string | null;
  cores: number | null;
  gpu: { name: string; driver: string | null; memory_mb: number } | null;
  use_graphics: boolean;
  tested_at: string | null;
  needs_test: boolean;
  jobs: HardwareJob[];
  test: { state: "idle" | "running" | "done" | "failed" | "cancelled"; step: string | null; job: HardwareJobName | null; progress: number; error: string | null };
}

export interface ComputersResponse {
  this_computer: {
    id: string | null;
    name: string | null;
    choice: ComputerChoice | null;
    does_work_now: boolean;
    needs_answer: boolean;
  };
  computers: Computer[];
}

async function send(endpoint: string, init: RequestInit = {}): Promise<ComputersResponse> {
  const res = await apiFetch(endpoint, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as ComputersResponse;
}

export const fetchComputers = () => send("/api/computers");

export const answerForThisComputer = (answer: ComputerAnswer) =>
  send("/api/computers/this/answer", { method: "POST", body: JSON.stringify({ answer }) });

export const setComputerChoice = (id: string, choice: ComputerChoice) =>
  send(`/api/computers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ choice }) });

export const forgetComputer = (id: string) => send(`/api/computers/${encodeURIComponent(id)}`, { method: "DELETE" });

async function hardware(endpoint: string, init: RequestInit = {}): Promise<Hardware> {
  const res = await apiFetch(endpoint, { ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Hardware;
}

/** T31 */
export const fetchHardware = () => hardware("/api/computers/this/hardware");
export const startHardwareTest = () => hardware("/api/computers/this/hardware/test", { method: "POST" });
export const cancelHardwareTest = () => hardware("/api/computers/this/hardware/test/cancel", { method: "POST" });
export const setUseGraphics = (on: boolean) => hardware("/api/computers/this/graphics", { method: "PUT", body: JSON.stringify({ on }) });
