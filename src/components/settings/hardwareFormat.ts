/**
 * Plain words for the graphics card check (T31, owner-approved mock-up 2026-11-24): what this
 * computer has, what runs where, and how much faster. Pure functions, unit-tested.
 */
import type { Hardware, HardwareJob, HardwareJobName } from "../../services/computers";

export const JOB_LABELS: Record<HardwareJobName, string> = {
  faces: "Sharpening faces",
  print: "8K print copies",
  colour: "Adding colour",
  scratches: "Removing scratches",
  finding_faces: "Finding faces",
};

/** "16 GB, plenty for old-photo fixes", or a gentle warning below 8 GB. */
export function memoryLine(h: Pick<Hardware, "memory_gb" | "memory_low">): string {
  return h.memory_low ? `${h.memory_gb} GB: old-photo fixes may be slow here` : `${h.memory_gb} GB, plenty for old-photo fixes`;
}

/** "AMD Ryzen 7 5700U · 8 cores". */
export function processorLine(h: Pick<Hardware, "cpu" | "cores">): string {
  return [h.cpu ?? "Processor", h.cores ? `${h.cores} cores` : ""].filter(Boolean).join(" · ");
}

/** The card's name, or that there is none SecurePhotos can use. */
export function graphicsLine(h: Pick<Hardware, "gpu">): string {
  return h.gpu ? h.gpu.name : "None SecurePhotos can use";
}

/** One row of "what runs where". */
export function jobRow(job: HardwareJob): { label: string; where: string; note: string; fast: boolean } {
  const label = JOB_LABELS[job.job];
  if (job.device === "gpu") return { label, where: "Graphics card", note: job.speedup ? `${formatSpeedup(job.speedup)} faster` : "faster", fast: true };
  if (job.device === "mixed") return { label, where: "Partly on the graphics card", note: "", fast: true };
  return { label, where: "Processor", note: job.why === "turned off" ? "card turned off" : "best here", fast: false };
}

/** 3.9 → "4×", 1.4 → "1.4×". */
export function formatSpeedup(x: number): string {
  return `${x >= 3 ? Math.round(x) : Math.round(x * 10) / 10}×`;
}

/** While the test runs: "Trying adding colour…". */
export function testingLine(h: Pick<Hardware, "test">): string {
  const job = h.test.job;
  return job ? `Trying ${JOB_LABELS[job].toLowerCase()} on the graphics card…` : "Getting ready…";
}

/** The sentence under "This computer is ready". */
export function readyText(h: Pick<Hardware, "gpu" | "jobs" | "use_graphics">): string {
  if (!h.gpu) {
    return "It has no graphics card SecurePhotos can use, so photos are improved on the processor. That works well; old-photo fixes just take a little longer, and they run while you do other things.";
  }
  if (!h.use_graphics) return `The ${h.gpu.name} graphics card is turned off for SecurePhotos here, so photos are improved on the processor.`;
  if (h.jobs.some((j) => j.device !== "cpu")) {
    return `The ${h.gpu.name} graphics card makes some photo fixes much faster here. SecurePhotos uses it wherever it helps.`;
  }
  return `The ${h.gpu.name} graphics card isn't faster than the processor for photo fixes here, so they run on the processor.`;
}

/** For another computer in Settings: "AMD Radeon 860M · faces, 8K print on the card". */
export function otherComputerGraphics(g: { gpu: string; jobs_on_gpu: HardwareJobName[]; use_graphics: boolean }): string {
  if (!g.use_graphics) return `${g.gpu} · turned off`;
  if (!g.jobs_on_gpu.length) return `${g.gpu} · not faster than the processor`;
  return `${g.gpu} · ${g.jobs_on_gpu.map((j) => JOB_LABELS[j].toLowerCase()).join(", ")} on the card`;
}
