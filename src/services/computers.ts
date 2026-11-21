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
