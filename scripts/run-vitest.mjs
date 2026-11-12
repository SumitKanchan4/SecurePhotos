// Runs Vitest (`npm test`). On Windows, Vitest loads itself twice when started from a folder
// path with a lowercase drive letter (e.g. a VS Code terminal in "c:\..."), and every test
// file then fails with "failed to find the current suite". Start it from the uppercase form
// of the same folder. Extra arguments are passed through (e.g. `npm test -- --watch`).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [join(cwd, "node_modules", "vitest", "vitest.mjs"), ...(args.length ? args : ["run"])], {
  cwd,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
