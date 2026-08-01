import { spawn } from "node:child_process";
import { withoutEsbuildBinaryOverride } from "./esbuild-process-env.mjs";

const [requestedCommand, ...args] = process.argv.slice(2);
if (!requestedCommand) {
  console.error(
    "Usage: node scripts/run-with-clean-esbuild-env.mjs <command> [...args]"
  );
  process.exit(2);
}

// Node 20.12+/24 on Windows refuses to spawn .cmd/.bat without shell:true
// (CVE-era spawn hardening → EINVAL). Prefer shell:true on win32 rather than
// rewriting the command name.
const child = spawn(requestedCommand, args, {
  env: withoutEsbuildBinaryOverride(),
  shell: process.platform === "win32",
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  if (code !== null) {
    process.exitCode = code;
    return;
  }
  if (signal === "SIGINT") {
    process.exitCode = 130;
    return;
  }
  process.exitCode = signal === "SIGTERM" ? 143 : 1;
});
