// CI dependency audit: fails on any high or critical npm advisory, except the few listed in
// ALLOWED below. Each exception names the advisory, why it is safe for now, and the date it
// must be looked at again; once that date passes, CI fails until the entry is removed or renewed.
//
// Usage: node scripts/ci/npm-audit-check.mjs
import { execSync } from "node:child_process";

// Each entry: "GHSA-…": { until: "YYYY-MM-DD", note: "why it is safe for now" }.
// The picomatch entry (GHSA-fc5q-39xc-vjpf) was removed on 2026-11-22: GitHub withdrew that advisory.
const ALLOWED = {};

const FAIL_ON = new Set(["high", "critical"]);

let raw;
try {
  raw = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero when it finds anything; the report is still on stdout.
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);
const blocking = [];
const allowed = new Set();
const expired = [];

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!FAIL_ON.has(vuln.severity)) continue;
  for (const via of vuln.via) {
    if (typeof via !== "object") continue; // Only "depends on <package>": judged at that package.
    const id = String(via.url ?? "").split("/").pop();
    if (!FAIL_ON.has(via.severity)) continue;
    const rule = ALLOWED[id];
    if (rule && today <= rule.until) allowed.add(`${id} (${name}): ${rule.note}, allowed until ${rule.until}`);
    else if (rule) expired.push(`${id} (${name}): allowance ended ${rule.until}`);
    else blocking.push(`${id || "advisory"} in ${name} (${via.severity}): ${via.title ?? ""} ${via.url ?? ""}`);
  }
}

for (const line of allowed) console.log(`Allowed for now: ${line}`);
if (blocking.length || expired.length) {
  for (const line of [...blocking, ...expired]) console.error(`Blocking: ${line}`);
  process.exit(1);
}
console.log("npm audit: no blocking high or critical advisories.");
