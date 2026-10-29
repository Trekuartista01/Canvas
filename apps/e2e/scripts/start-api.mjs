// Starts the API and the BullMQ worker together for Playwright's webServer.
// Replaces a `sh -c '... & ...'` one-liner that broke on Windows: Playwright
// runs webServer commands through cmd.exe there, which doesn't treat single
// quotes as quoting, so only the worker ever started and the API health
// check timed out. Plain Node works the same on every platform.
import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

// shell: true so `pnpm` resolves to pnpm.cmd on Windows.
const start = (script) =>
  spawn(`pnpm --filter @canvas/api ${script}`, { stdio: "inherit", shell: true });

const children = [start("worker"), start("dev")];

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // With shell: true the direct child is the shell; on Windows only
    // taskkill /T reaches the tsx process underneath it.
    if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
  }
  process.exit(code);
}

// If either process dies, take the other down too, so a crashed worker
// can't leave specs that need it waiting on a server that only looks healthy.
for (const child of children) child.on("exit", (code) => stopAll(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stopAll(0));
