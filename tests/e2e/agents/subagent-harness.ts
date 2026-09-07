import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ElectronApplication, expect } from "@playwright/test";

export const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
export const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");

interface CliV2Result {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: unknown };
  ok: boolean;
}

interface RawCli {
  code: number;
  json?: CliV2Result | undefined;
  stderr: string;
}

interface RunOptions {
  origin?: { panelId: string; windowId: string } | undefined;
  overrides?: Record<string, string | undefined>;
  stdin?: string;
}

export function isolatedTestEnv(
  userDataDir: string,
  overrides: Record<string, string | undefined> = {}
): Record<string, string> {
  // A test invoked inside Pier must never inherit its live control socket,
  // panel identity or dev profile. Both Electron and CLI use this fixture.
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("PIER_"))
    ),
    ELECTRON_USER_DATA_DIR: userDataDir,
    PIER_USER_DATA_DIR: userDataDir,
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

function fixturePath(binDir: string): string {
  return `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`;
}

export function fakeAgentEnv(
  userDataDir: string,
  binDir: string
): Record<string, string> {
  return isolatedTestEnv(userDataDir, {
    PATH: fixturePath(binDir),
    SHELL: "/bin/zsh",
    ZDOTDIR: binDir,
    GHOSTTY_RESOURCES_DIR: join(
      PROJECT_ROOT,
      "native",
      "GhosttyResources",
      "ghostty"
    ),
  });
}

function cliEnv(
  userDataDir: string,
  origin?: { panelId: string; windowId: string },
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    ...isolatedTestEnv(userDataDir, overrides),
    ...(origin
      ? { PIER_PANEL_ID: origin.panelId, PIER_WINDOW_ID: origin.windowId }
      : {}),
  };
}

export function runPierCli(
  userDataDir: string,
  args: string[],
  options: RunOptions = {}
): RawCli {
  const fullArgs = args.includes("--json") ? args : [...args, "--json"];
  const spawned = spawnSync("node", [PIER_CLI, ...fullArgs], {
    encoding: "utf8",
    cwd: PROJECT_ROOT,
    env: cliEnv(userDataDir, options.origin, options.overrides),
    input: options.stdin ?? "",
    timeout: 90_000,
  });
  let json: CliV2Result | undefined;
  try {
    json = JSON.parse((spawned.stdout ?? "").trim()) as CliV2Result;
  } catch {
    // 非 JSON 输出（usage / 纯文本错误）保留 stderr 即可
  }
  return { code: spawned.status ?? -1, json, stderr: spawned.stderr ?? "" };
}

export async function runPierCliJson<T>(
  userDataDir: string,
  args: string[],
  origin?: { panelId: string; windowId: string } | undefined
): Promise<T> {
  const raw = runPierCli(userDataDir, args, { origin });
  expect(raw.code, `pier ${args.join(" ")} failed: ${raw.stderr}`).toBe(0);
  expect(
    raw.json?.ok,
    `pier ${args.join(" ")} not ok; stdout=${raw.stderr || "<empty>"}`
  ).toBe(true);
  return raw.json?.data as T;
}

export async function waitForPierCli(userDataDir: string) {
  await expect
    .poll(async () => runPierCli(userDataDir, ["status"]).code === 0, {
      timeout: 20_000,
    })
    .toBe(true);
}

interface CliPanelList {
  errors: unknown[];
  panels: Array<{ active?: boolean; id: string; windowId: string }>;
}

function terminalPanels(snapshot: CliPanelList) {
  return snapshot.panels.filter((panel) => panel.id.startsWith("terminal-"));
}

export async function waitForTerminalPanelCount(
  userDataDir: string,
  count: number
) {
  await expect
    .poll(
      () => {
        const raw = runPierCli(userDataDir, ["panels", "list"]);
        // Socket startup precedes the renderer command bridge. A transient
        // not-ready response must be retried, not thrown out of expect.poll.
        return raw.json?.ok
          ? terminalPanels(raw.json.data as unknown as CliPanelList).length
          : -1;
      },
      { timeout: 15_000 }
    )
    .toBe(count);
}

interface AgentIndexEntry {
  agentId: string;
  panelId: string;
  status?: string;
  windowId: string;
}

export async function agentsList(
  userDataDir: string
): Promise<{ entries: AgentIndexEntry[]; ts: number }> {
  return runPierCliJson(userDataDir, ["agents", "list"]);
}

function controlSocketPath(userDataDir: string): string {
  return join(userDataDir, "pier-control.sock");
}

interface V1Result {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  ok: boolean;
}

/** 直连 v1 控制socket 发 terminal.open(+launch.agentId)：产品真实智能体建面管线。 */
function v1OpenAgentPanel(
  userDataDir: string,
  opts: { focus?: boolean } = {}
): Promise<{ panelId: string; windowId: string }> {
  const envelope = {
    protocolVersion: 1,
    requestId: randomUUID(),
    clientId: "cli-local",
    command: {
      type: "terminal.open",
      // 用产品新的后台建面管线引导父智能体面板（同时实机验证 R19）。
      backgroundCreate: true,
      focus: opts.focus ?? false,
      launch: { agentId: "claude" },
    },
  };
  return new Promise((resolve, reject) => {
    const socket: Socket = netConnect(controlSocketPath(userDataDir), () => {
      socket.write(`${JSON.stringify(envelope)}\n`);
    });
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split("\n").find((candidate) => candidate.trim());
      if (!line) {
        return;
      }
      socket.end();
      try {
        const result = JSON.parse(line) as V1Result;
        if (!result.ok) {
          reject(new Error(result.error?.message ?? "terminal.open failed"));
          return;
        }
        const rawPanelId = result.data?.panelId ?? result.data?.id;
        const panelId = typeof rawPanelId === "string" ? rawPanelId : undefined;
        const windowId =
          typeof result.data?.windowId === "string"
            ? result.data.windowId
            : undefined;
        if (!(panelId && windowId)) {
          reject(
            new Error(
              `terminal.open missing ids: ${JSON.stringify(result.data)}`
            )
          );
          return;
        }
        resolve({ panelId, windowId });
      } catch (err) {
        reject(err instanceof Error ? err : String(err));
      }
    });
    socket.on("error", reject);
  });
}

/** 把替身 claude 二进制放到 PATH 最前：命令启动探测与子 PTY 都解析到它。 */
export function installFakeAgent(): string {
  const binDir = mkdtempSync(join(tmpdir(), "pier-fake-agent-"));
  // PES intentionally loads login-shell environment. Keep that shell isolated
  // too, so personal rc files cannot replace fixtures with real model CLIs.
  const pathValue = fixturePath(binDir).replaceAll("'", "'\\''");
  writeFileSync(
    join(binDir, ".zshenv"),
    `unsetopt GLOBAL_RCS\nexport PATH='${pathValue}'\n`
  );
  const stub = join(binDir, "claude");
  writeFileSync(
    stub,
    `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('Usage: claude [prompt]'); process.exit(0); }
if (args.includes('--version')) { console.log('1.0.0-fixture'); process.exit(0); }
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, process.env.PIER_PANEL_ID + '.argv.json'), JSON.stringify(args));
console.log('INITIAL_ARGV:' + JSON.stringify(args));
process.on('SIGINT', () => console.log('NATIVE_SIGINT_RECEIVED'));
process.on('SIGTERM', () => process.exit(0));
process.stdin.on('data', (text) => console.log('SUBMITTED:' + text.toString()));
if (args.some((arg) => arg.includes('TEST_STUBBORN_MODE'))) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});process.on('SIGINT',()=>{});console.log('STUBBORN_READY:'+process.pid);setInterval(()=>{},1000)"], { stdio: 'inherit' });
  fs.writeFileSync(path.join(__dirname, process.env.PIER_PANEL_ID + '.child.pid'), String(child.pid));
}
if (args.some((arg) => arg.includes('TEST_EXIT_MODE'))) {
  console.log('EXIT_READY');
  setTimeout(() => process.exit(0), 400);
} else {
  setInterval(() => {}, 1000);
}
`
  );
  chmodSync(stub, 0o755);
  const approval = join(binDir, "codex");
  writeFileSync(
    approval,
    `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('Usage: codex [PROMPT]'); process.exit(0); }
if (args.includes('--version')) { console.log('0.153.4-fixture'); process.exit(0); }
fs.writeFileSync(path.join(__dirname, process.env.PIER_PANEL_ID + '.argv.json'), JSON.stringify(args));
console.log('Hooks need review'); console.log('Trust all and continue'); console.log('Press enter to confirm');
let continued = false;
process.stdin.on('data', () => {
  if (continued) return;
  continued = true;
  fs.writeFileSync(path.join(__dirname, process.env.PIER_PANEL_ID + '.continued.json'), JSON.stringify(args));
  console.log('\\x1b[2J\\x1b[HCONTINUED_ONCE');
});
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`
  );
  chmodSync(approval, 0o755);
  const fallback = join(binDir, "aider");
  writeFileSync(
    fallback,
    `#!${process.execPath}
if (process.argv.includes('--help')) { console.log('Usage: aider'); process.exit(0); }
if (process.argv.includes('--version')) { console.log('0.1.0-fixture'); process.exit(0); }
console.log('AIDER_READY'); process.stdin.resume();
process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);
`
  );
  chmodSync(fallback, 0o755);
  return binDir;
}

export async function bootstrapParentAgent(
  userDataDir: string
): Promise<{ panelId: string; windowId: string }> {
  // The control socket is ready before the renderer mounts Dockview.
  await waitForTerminalPanelCount(userDataDir, 1);
  const opened = await v1OpenAgentPanel(userDataDir);
  const deadline = Date.now() + 30_000;
  let lastEntries: AgentIndexEntry[] = [];
  while (Date.now() < deadline) {
    lastEntries = (await agentsList(userDataDir)).entries;
    const hit = lastEntries.find(
      (candidate) => candidate.panelId === opened.panelId
    );
    if (hit) {
      // v1 响应的 windowId 是窗口内部名（如 "main"）；origin 以 FA 索引为准。
      return { panelId: opened.panelId, windowId: hit.windowId };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `agent entry not found for ${JSON.stringify(opened)}; entries=${JSON.stringify(lastEntries)}`
  );
}

export interface StartOk {
  panelId: string;
  runtime: { bootId: string; generation: number; runtimeId: string };
}

export function startChild(
  userDataDir: string,
  origin: { panelId: string; windowId: string },
  extraArgs: string[] = []
): RawCli {
  return runPierCli(
    userDataDir,
    ["agents", "start", "claude", "--stdin", ...extraArgs],
    {
      origin,
      stdin: "只回复 OK",
    }
  );
}

export function screenContainsMarker(
  userDataDir: string,
  origin: { panelId: string; windowId: string },
  child: StartOk,
  needle: string
) {
  const args = [
    "agents",
    "screen",
    "--boot",
    child.runtime.bootId,
    "--runtime",
    child.runtime.runtimeId,
    "--generation",
    String(child.runtime.generation),
  ];
  return expect
    .poll(
      () => {
        const raw = runPierCli(userDataDir, args, { origin });
        const data = raw.json?.data as
          | { screen?: { text?: string } }
          | undefined;
        return data?.screen?.text ?? JSON.stringify(raw);
      },
      { timeout: 20_000 }
    )
    .toContain(needle);
}

const appErrors = new WeakMap<ElectronApplication, string>();
const closedApps = new WeakSet<ElectronApplication>();
const appLogPaths = new WeakMap<ElectronApplication, string>();

/** Verify graceful quit; bounded fixture cleanup must not masquerade as success. */
export async function closeTestApp(app: ElectronApplication): Promise<void> {
  if (closedApps.has(app)) return;
  closedApps.add(app);
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  );
  let forced = false;
  const sampleTimer = setTimeout(() => {
    const path = appLogPaths.get(app);
    if (path && child.pid) {
      const sample = spawnSync(
        "/usr/bin/sample",
        [String(child.pid), "1", "-file", `${path}.quit-sample.txt`],
        { timeout: 10_000, encoding: "utf8" }
      );
      writeFileSync(
        `${path}.sample-command.log`,
        `${sample.stdout}\n${sample.stderr}\n${sample.error ?? ""}`
      );
    }
  }, 9000);
  const timer = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 15_000);
  try {
    await app.close();
    await exited;
  } finally {
    clearTimeout(timer);
    clearTimeout(sampleTimer);
  }
  expect(forced, "Electron did not quit gracefully").toBe(false);
  expect(appErrors.get(app) ?? "").not.toMatch(/E2E_UNCAUGHT|E2E_UNHANDLED/u);
}

export async function captureTestAppErrors(
  app: ElectronApplication,
  path: string
): Promise<void> {
  appLogPaths.set(app, path);
  app.process().stderr?.on("data", (chunk: Buffer) => {
    appErrors.set(app, (appErrors.get(app) ?? "") + chunk.toString());
    writeFileSync(path, chunk, { flag: "a" });
  });
  await app.evaluate(() => {
    process.on("uncaughtException", (error) => {
      console.error("E2E_UNCAUGHT", error.stack ?? error.message);
    });
    process.on("unhandledRejection", (error) => {
      console.error("E2E_UNHANDLED", error);
    });
  });
}
