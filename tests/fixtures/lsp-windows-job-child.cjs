"use strict";
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const mode = process.argv[2];

if (mode === "hold") {
  setInterval(() => undefined, 60_000);
} else if (mode === "server-first-exit") {
  const grandchild = spawn(process.execPath, [__filename, "hold"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (!grandchild.pid) {
    process.stderr.write("failed to spawn hold grandchild\n");
    process.exit(3);
  }
  // Keep a hard ref until we intentionally exit so the child is fully
  // created before the intermediate server leaves the tree.
  globalThis.__pierLspWindowsJobGrandchild = grandchild;
  process.stdout.write(
    `${JSON.stringify({ grandchildPid: grandchild.pid })}\n`
  );
  setTimeout(() => {
    process.exit(0);
  }, 150);
} else if (mode === "supervisor") {
  const lines = readline.createInterface({ input: process.stdin });
  lines.once("line", (line) => {
    if (line !== "start") {
      process.exit(2);
      return;
    }
    const server = spawn(process.execPath, [__filename, "server-first-exit"], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    server.stdout.pipe(process.stdout, { end: false });
    server.once("exit", () => {
      process.stdout.write(`${JSON.stringify({ serverExited: true })}\n`);
    });
  });
  setInterval(() => undefined, 60_000);
} else {
  process.stderr.write(`unknown fixture mode: ${String(mode)}\n`);
  process.exit(2);
}
