import { spawn } from "node:child_process";
import { withoutEsbuildBinaryOverride } from "./esbuild-process-env.mjs";

const [requestedCommand, ...args] = process.argv.slice(2);
if (!requestedCommand) {
  console.error(
    "Usage: node scripts/run-with-clean-esbuild-env.mjs <command> [...args]"
  );
  process.exit(2);
}

const command =
  process.platform === "win32" && !requestedCommand.endsWith(".cmd")
    ? `${requestedCommand}.cmd`
    : requestedCommand;
const child = spawn(command, args, {
  env: withoutEsbuildBinaryOverride(),
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
