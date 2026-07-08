#!/usr/bin/env node

import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function start(label, command, args) {
  const child = spawn(command, args, {
    env: process.env,
    stdio: "inherit",
  });
  children.push({ child, label });
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(`[dev] ${label} exited (${signal ?? exitCode})`);
    shutdown(exitCode);
  });
  child.on("error", (err) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] ${label} failed to start: ${err.message}`);
    shutdown(1);
  });
}

function shutdown(code) {
  shuttingDown = true;
  for (const { child } of children) {
    if (isRunning(child)) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      if (isRunning(child)) {
        child.kill("SIGKILL");
      }
    }
    process.exit(code);
  }, 3000).unref();
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

start("plugin-codex main watch", "pnpm", [
  "--filter",
  "@pier/plugin-codex",
  "dev:main",
]);
start("plugin-codex renderer watch", "pnpm", [
  "--filter",
  "@pier/plugin-codex",
  "dev:renderer",
]);
start("electron dev", "node", ["./scripts/dev-profile.mjs", "electron-dev"]);
