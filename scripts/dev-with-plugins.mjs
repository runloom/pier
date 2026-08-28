#!/usr/bin/env node

import { spawn } from "node:child_process";
import { withoutEsbuildBinaryOverride } from "./esbuild-process-env.mjs";

const children = [];
const childEnv = withoutEsbuildBinaryOverride();
let shuttingDown = false;
const ELECTRON_READY_RE = /starting electron app/;
const ELECTRON_READY_TIMEOUT_MS = 180_000;

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    env: childEnv,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
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
  return child;
}

function waitForOutput(child, pattern, timeoutMs) {
  return new Promise((resolve) => {
    let matched = false;
    const onData = (buf) => {
      process.stdout.write(buf);
      if (!matched && pattern.test(buf.toString())) {
        matched = true;
        resolve(true);
      }
    };
    const onExit = () => {
      if (!matched) {
        matched = true;
        resolve(false);
      }
    };
    const timer = setTimeout(() => {
      if (!matched) {
        matched = true;
        resolve(false);
      }
    }, timeoutMs);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
    timer.unref?.();
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

function startPluginWatchers() {
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
  start("plugin-grok main watch", "pnpm", [
    "--filter",
    "@pier/plugin-grok",
    "dev:main",
  ]);
  start("plugin-grok renderer watch", "pnpm", [
    "--filter",
    "@pier/plugin-grok",
    "dev:renderer",
  ]);
  start("plugin-ssh main watch", "pnpm", [
    "--filter",
    "@pier/plugin-ssh",
    "dev:main",
  ]);
  start("plugin-ssh renderer watch", "pnpm", [
    "--filter",
    "@pier/plugin-ssh",
    "dev:renderer",
  ]);
  start("agent-splits main watch", "pnpm", [
    "--filter",
    "@pier/plugin-agent-splits",
    "dev:main",
  ]);
  start("agent-splits renderer watch", "pnpm", [
    "--filter",
    "@pier/plugin-agent-splits",
    "dev:renderer",
  ]);
  start("plugin-claude main watch", "pnpm", [
    "--filter",
    "@pier/plugin-claude",
    "dev:main",
  ]);
  start("plugin-claude renderer watch", "pnpm", [
    "--filter",
    "@pier/plugin-claude",
    "dev:renderer",
  ]);
  // 移动端 Web 壳：vite build --watch，产物落 out/mobile-web/ 供 remote-control 托管
  start("mobile-web vite watch", "pnpm", [
    "--filter",
    "@pier/mobile-web",
    "dev",
  ]);
}

const electron = start(
  "electron dev",
  "node",
  ["./scripts/dev-profile.mjs", "electron-dev"],
  { capture: true }
);
const electronReady = await waitForOutput(
  electron,
  ELECTRON_READY_RE,
  ELECTRON_READY_TIMEOUT_MS
);
if (electronReady) {
  console.log("[dev] electron ready; starting plugin watchers");
} else {
  console.error(
    "[dev] electron did not become ready in time; starting plugin watchers anyway"
  );
}
startPluginWatchers();
