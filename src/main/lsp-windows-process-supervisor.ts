import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

import type { LspServerLaunchSpec } from "@shared/contracts/lsp-provider.ts";

const MAX_CONTROL_BYTES = 8 * 1024;
const controlInput = createReadStream("", { autoClose: false, fd: 3 });
const controlOutput = createWriteStream("", { autoClose: false, fd: 4 });
const lines = createInterface({ input: controlInput, terminal: false });
let receivedBytes = 0;
let started = false;

function report(message: Record<string, unknown>): void {
  const body = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(body, "utf8") <= MAX_CONTROL_BYTES) {
    controlOutput.write(body);
  }
}

report({ type: "supervisor-ready" });

controlInput.on("data", (chunk: string | Buffer) => {
  receivedBytes +=
    typeof chunk === "string"
      ? Buffer.byteLength(chunk, "utf8")
      : chunk.byteLength;
  if (receivedBytes > MAX_CONTROL_BYTES && !started) {
    report({ message: "start control exceeded 8KiB", type: "spawn-error" });
    process.exitCode = 1;
    lines.close();
  }
});

lines.once("line", (line) => {
  if (receivedBytes > MAX_CONTROL_BYTES) {
    return;
  }
  let launch: LspServerLaunchSpec;
  try {
    const message = JSON.parse(line) as {
      launch?: LspServerLaunchSpec;
      type?: unknown;
    };
    if (
      message.type !== "start" ||
      !message.launch ||
      typeof message.launch.command !== "string" ||
      !Array.isArray(message.launch.args)
    ) {
      throw new Error("invalid start command");
    }
    launch = message.launch;
  } catch (error) {
    report({
      message: error instanceof Error ? error.message : "invalid start command",
      type: "spawn-error",
    });
    process.exitCode = 1;
    controlInput.destroy();
    return;
  }

  started = true;
  const server = spawn(launch.command, [...launch.args], {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  process.stdin.pipe(server.stdin);
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);
  server.once("spawn", () => report({ pid: server.pid, type: "server-ready" }));
  server.once("error", (error) => {
    report({ message: error.message, type: "spawn-error" });
  });
  server.once("exit", (code, signal) => {
    report({ code, signal, type: "server-exit" });
  });
});

controlInput.once("end", () => {
  if (!started) {
    process.exit(0);
  }
});
