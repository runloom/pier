import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

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

function cliEnv(
  userDataDir: string,
  origin?: { panelId: string; windowId: string },
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    ...process.env,
    PIER_USER_DATA_DIR: userDataDir,
    ...overrides,
    ...(origin
      ? { PIER_PANEL_ID: origin.panelId, PIER_WINDOW_ID: origin.windowId }
      : {}),
  };
}

function runPierCli(
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

async function runPierCliJson<T>(
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

async function waitForPierCli(userDataDir: string) {
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

async function panelList(userDataDir: string): Promise<CliPanelList> {
  return runPierCliJson<CliPanelList>(userDataDir, ["panels", "list"]);
}

async function waitForTerminalPanelCount(userDataDir: string, count: number) {
  await expect
    .poll(async () => terminalPanels(await panelList(userDataDir)).length, {
      timeout: 15_000,
    })
    .toBe(count);
}

interface AgentIndexEntry {
  agentId: string;
  panelId: string;
  status?: string;
  windowId: string;
}

async function agentsList(
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
function installFakeAgent(): string {
  const binDir = mkdtempSync(join(tmpdir(), "pier-fake-agent-"));
  const stub = join(binDir, "claude");
  writeFileSync(stub, "#!/bin/sh\nsleep 900\n");
  chmodSync(stub, 0o755);
  return binDir;
}

async function bootstrapParentAgent(
  userDataDir: string
): Promise<{ panelId: string; windowId: string }> {
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

interface StartOk {
  panelId: string;
  runtime: { bootId: string; generation: number; runtimeId: string };
}

function startChild(
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

function screenContainsMarker(
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
        return String(data?.screen?.text ?? "").includes(needle);
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}

test("agents start CLI parsing guards reject without touching the app", () => {
  const noSocket = "/tmp/pier-subagent-nosocket";
  const baseEnv = { PIER_PANEL_ID: "panel_x", PIER_WINDOW_ID: "win_x" };

  const disabled = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "hi",
      overrides: { ...baseEnv, PIER_AGENT_PANELS_DISABLED: "1" },
    }
  );
  expect(disabled.stderr).toContain("PIER_AGENT_PANELS_DISABLED");
  expect(disabled.code).toBe(1);

  const noOrigin = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "hi",
      overrides: { PIER_PANEL_ID: undefined, PIER_WINDOW_ID: undefined },
    }
  );
  expect(noOrigin.stderr).toContain("PIER_PANEL_ID");
  expect(noOrigin.code).toBe(1);

  const tooLong = runPierCli(
    noSocket,
    ["agents", "start", "claude", "--stdin"],
    {
      stdin: "a".repeat(70_000),
      overrides: baseEnv,
    }
  );
  expect(tooLong.stderr).toContain("prompt_too_long");
  expect(tooLong.code).toBe(5);
});

test("agents start delegation golden chain over real native terminals", async () => {
  test.setTimeout(240_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-subagent-e2e-"));
  const fakeBin = installFakeAgent();
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PIER_USER_DATA_DIR: userDataDir,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    },
  });

  const done = (async () => {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await waitForPierCli(userDataDir);
    await waitForTerminalPanelCount(userDataDir, 1);

    const origin = await bootstrapParentAgent(userDataDir);

    // 金路径：委派成功 + marker 投递到真实 surface。
    const first = startChild(userDataDir, origin);
    expect(
      first.code,
      `first=${JSON.stringify(first)} entries=${JSON.stringify((await agentsList(userDataDir)).entries)}`
    ).toBe(0);
    expect(first.json?.ok).toBe(true);
    const child1 = first.json?.data as unknown as StartOk;
    expect(child1.runtime.runtimeId).toBeTruthy();

    await screenContainsMarker(
      userDataDir,
      origin,
      child1,
      `[Delegated by parent claude panel ${origin.panelId}]`
    );

    // 配额：默认 4；第 5 次 quota_exceeded(exit 4)。
    const second = startChild(userDataDir, origin);
    expect(second.json?.ok).toBe(true);
    const third = startChild(userDataDir, origin);
    expect(third.json?.ok).toBe(true);
    const fourth = startChild(userDataDir, origin);
    expect(fourth.json?.ok).toBe(true);
    const fifth = startChild(userDataDir, origin);
    expect(fifth.json?.ok).toBe(false);
    expect(fifth.json?.error?.code).toBe("quota_exceeded");
    expect(fifth.code).toBe(4);

    // 关闭一个子面板 → 释放占额 → 再 spawn 成功。
    await runPierCliJson(userDataDir, ["terminal", "close", child1.panelId]);
    await expect
      .poll(() => startChild(userDataDir, origin).json?.ok === true, {
        timeout: 15_000,
      })
      .toBe(true);

    // 跨窗拒绝：origin 有效但顶层 --window 指向别的窗口（fail-fast，不占额）。
    const crossWindow = runPierCli(
      userDataDir,
      ["agents", "start", "claude", "--stdin", "--window", "999999"],
      {
        origin,
        stdin: "hi",
      }
    );
    expect(crossWindow.json?.error?.code).toBe("cross_window_unsupported");
    expect(crossWindow.code).toBe(6);

    // 伪造 origin：invalid_origin(exit 3)。
    const ghost = runPierCli(userDataDir, ["agents", "start", "claude"], {
      origin: { panelId: "panel_ghost", windowId: origin.windowId },
      stdin: "hi",
    });
    expect(ghost.json?.error?.code).toBe("invalid_origin");
    expect(ghost.code).toBe(3);
  })();

  return done.finally(async () => {
    await app.close().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });
});
