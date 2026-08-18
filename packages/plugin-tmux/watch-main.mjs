#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(import.meta.url));
const children = ["vite.config.main.ts", "vite.config.tmux.ts"].map((config) =>
  spawn("pnpm", ["exec", "vite", "build", "--config", config, "--watch"], {
    cwd,
    stdio: "inherit",
  })
);

function shutdown(code = 0) {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});
