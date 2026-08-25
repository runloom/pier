import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect as netConnect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

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
const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";

async function launchPierApp(
  userDataDir: string,
  extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv } as Record<string, string>,
  });
}

/**
 * 闲置机/干净环境自举：dist-pkg 被 gitignore，runner 上没有插件产物。
 * 先本地打包，再写入 workspace 配置（.pier-dev 被 gitignore，用完即恢复），
 * 应用以 workspace 模式启动时会把本插件装回并启用。
 */
/** 替身智能体二进制：自报 preset 相关 env 与 args（输出进 PTY viewport）。 */
function installFakeAgent(): string {
  const binDir = mkdtempSync(join(tmpdir(), "pier-fake-agent-"));
  const report = [
    "#!/bin/sh",
    'echo "TMUX=$TMUX"',
    'echo "TEAMS=$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"',
    'echo "OMO_DIR=$OPENCODE_CONFIG_DIR"',
    'echo "OMO_PORT=$OPENCODE_PORT"',
    'echo "ARGS:$@"',
    "exec sleep 900",
    "",
  ].join("\n");
  for (const name of ["claude", "opencode"]) {
    const stub = join(binDir, name);
    writeFileSync(stub, report);
    chmodSync(stub, 0o755);
  }
  return binDir;
}

function bootstrapWorkspacePlugin(): () => void {
  const pierDevDir = join(PROJECT_ROOT, ".pier-dev");
  const wsConfigPath = join(pierDevDir, "plugin-workspace.json");
  const backup = existsSync(wsConfigPath)
    ? readFileSync(wsConfigPath, "utf8")
    : null;
  mkdirSync(pierDevDir, { recursive: true });
  writeFileSync(
    wsConfigPath,
    JSON.stringify({
      mode: "workspace",
      roots: [
        { id: "pier.agent-splits", path: "packages/plugin-agent-splits" },
      ],
    })
  );
  execFileSync(
    "pnpm",
    ["--filter", "@pier/plugin-agent-splits", "build:package"],
    { cwd: PROJECT_ROOT, stdio: "pipe", timeout: 300_000 }
  );
  return () => {
    if (backup === null) {
      rmSync(wsConfigPath, { force: true });
    } else {
      writeFileSync(wsConfigPath, backup);
    }
  };
}

interface AgentIndexEntry {
  agentId: string;
  panelId: string;
  windowId: string;
}

async function panelList(userDataDir: string): Promise<{
  errors: unknown[];
  panels: Array<{ id: string; windowId: string }>;
}> {
  const raw = runPierCli(userDataDir, ["panels", "list"]);
  expect(raw.code, raw.stderr).toBe(0);
  return raw.json?.data as {
    errors: unknown[];
    panels: Array<{ id: string; windowId: string }>;
  };
}

async function agentsList(userDataDir: string): Promise<{
  entries: AgentIndexEntry[];
}> {
  const raw = runPierCli(userDataDir, ["agents", "list"]);
  expect(raw.code, raw.stderr).toBe(0);
  return raw.json?.data as { entries: AgentIndexEntry[] };
}

/** v1 socket 直发 terminal.open(+launch.agentId)：产品真实智能体建面管线。 */
function v1OpenAgentPanel(
  userDataDir: string
): Promise<{ panelId: string; windowId: string }> {
  const envelope = {
    protocolVersion: 1,
    requestId: randomUUID(),
    clientId: "cli-local",
    command: {
      type: "terminal.open",
      backgroundCreate: true,
      focus: false,
      launch: { agentId: "claude" },
    },
  };
  return new Promise((resolve, reject) => {
    const socket: Socket = netConnect(
      join(userDataDir, "pier-control.sock"),
      () => {
        socket.write(`${JSON.stringify(envelope)}\n`);
      }
    );
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split("\n").find((candidate) => candidate.trim());
      if (!line) {
        return;
      }
      socket.end();
      try {
        const result = JSON.parse(line) as {
          ok: boolean;
          error?: { message?: string };
          data?: Record<string, unknown>;
        };
        if (!result.ok) {
          reject(new Error(result.error?.message ?? "terminal.open failed"));
          return;
        }
        const rawPanelId = result.data?.panelId ?? result.data?.id;
        const windowId = result.data?.windowId;
        if (typeof rawPanelId !== "string" || typeof windowId !== "string") {
          reject(
            new Error(
              `terminal.open missing ids: ${JSON.stringify(result.data)}`
            )
          );
          return;
        }
        resolve({ panelId: rawPanelId, windowId });
      } catch (err) {
        reject(err instanceof Error ? err : String(err));
      }
    });
    socket.on("error", reject);
  });
}

/** 父智能体面板：v1 打开后等 FA 索引出现（origin 解析的数据源）。 */
async function bootstrapParentAgent(
  userDataDir: string
): Promise<{ panelId: string; windowId: string }> {
  const opened = await v1OpenAgentPanel(userDataDir);
  let hit: AgentIndexEntry | undefined;
  await expect
    .poll(
      async () => {
        hit = (await agentsList(userDataDir)).entries.find(
          (candidate) => candidate.panelId === opened.panelId
        );
        return hit !== undefined;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  // v1 响应的 windowId 是窗口内部名；origin 以 FA 索引为准。
  return { panelId: opened.panelId, windowId: hit!.windowId };
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

interface CliV2Result {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  ok: boolean;
}

interface RawCli {
  code: number;
  json?: CliV2Result | undefined;
  stderr: string;
}

function runPierCli(
  userDataDir: string,
  args: string[],
  origin?: { panelId: string; windowId: string },
  stdin = ""
): RawCli {
  const env: Record<string, string> = {
    ...process.env,
    PIER_USER_DATA_DIR: userDataDir,
  } as Record<string, string>;
  if (origin) {
    env.PIER_PANEL_ID = origin.panelId;
    env.PIER_WINDOW_ID = origin.windowId;
  }
  const spawned = spawnSync("node", [PIER_CLI, ...args, "--json"], {
    encoding: "utf8",
    cwd: PROJECT_ROOT,
    env,
    input: stdin,
    timeout: 90_000,
  });
  let json: CliV2Result | undefined;
  try {
    json = JSON.parse((spawned.stdout ?? "").trim()) as CliV2Result;
  } catch {
    // usage/纯文本错误保留退出码即可
  }
  return {
    code: spawned.status ?? -1,
    json,
    stderr: spawned.stderr ?? "",
  };
}

test.describe("Agent splits plugin e2e", () => {
  test("enabled pier.agent-splits ships its adapter settings page", async () => {
    test.setTimeout(90_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-tmux-e2e-"));
    const restoreWorkspace = bootstrapWorkspacePlugin();
    let app: ElectronApplication | undefined;
    try {
      app = await launchPierApp(userDataDir, {
        PIER_PLUGIN_MODE: "workspace",
      });
      const win = await app.firstWindow();
      await waitForWorkspaceReady(win);
      await win.keyboard.press(SETTINGS_ACCELERATOR);
      await expect(win.locator('[role="dialog"]')).toBeVisible({
        timeout: 10_000,
      });

      // 方向 A：设置面回归——侧栏出现插件设置页导航（运行态已加载并启用）。
      // 注：「已安装」列表行依赖 workspace 首方自动安装的簿记（存量缺口，
      // pier.ssh 同样缺失），故此处经侧栏导航直达设置页本体。
      const navItem = win.locator(
        '[data-testid="settings-nav-plugin-pier.agent-splits"]'
      );
      await expect(navItem).toBeVisible({ timeout: 15_000 });
      await navItem.click();

      // 适配器设置页：五个即时偏好开关（适配器三键默认开 + 预设两键默认关）。
      const switches = win.getByRole("switch");
      await expect(switches).toHaveCount(5);
      await expect(switches.nth(0)).toBeChecked();
      await expect(switches.nth(1)).toBeChecked();
      await expect(switches.nth(2)).toBeChecked();
      await expect(switches.nth(3)).not.toBeChecked();
      await expect(switches.nth(4)).not.toBeChecked();

      // visibleWhen：关总开关 → 分智能体开关即时隐藏。
      await switches.nth(0).click();
      await expect(win.getByRole("switch")).toHaveCount(1);
      await expect(win.getByRole("switch")).not.toBeChecked();

      // 即时偏好持久化：关闭并重开设置后总开关仍为关。
      await win.keyboard.press("Escape");
      await expect(win.locator('[role="dialog"]')).toHaveCount(0);
      await win.keyboard.press(SETTINGS_ACCELERATOR);
      await expect(win.locator('[role="dialog"]')).toBeVisible({
        timeout: 10_000,
      });
      await win
        .locator('[data-testid="settings-nav-plugin-pier.agent-splits"]')
        .click();
      const reopened = win.getByRole("switch");
      await expect(reopened).toHaveCount(1);
      await expect(reopened).not.toBeChecked();

      // 恢复总开 → 子开关随 visibleWhen 回归（适配器键保持开、预设键保持关）。
      await reopened.click();
      const restored = win.getByRole("switch");
      await expect(restored).toHaveCount(5);
      await expect(restored.nth(1)).toBeChecked();
      await expect(restored.nth(3)).not.toBeChecked();
    } finally {
      await app?.close();
      rmSync(userDataDir, { recursive: true, force: true });
      restoreWorkspace();
    }
  });

  test("presets inject env and args into spawned agent terminals", async () => {
    test.setTimeout(240_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-preset-e2e-"));
    const fakeBin = installFakeAgent();
    const restoreWorkspace = bootstrapWorkspacePlugin();
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PIER_USER_DATA_DIR: userDataDir,
        PIER_PLUGIN_MODE: "workspace",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      } as Record<string, string>,
    });

    const done = (async () => {
      const win = await app.firstWindow();
      await waitForWorkspaceReady(win);
      await expect
        .poll(async () => runPierCli(userDataDir, ["status"]).code === 0, {
          timeout: 20_000,
        })
        .toBe(true);
      await expect
        .poll(
          async () =>
            (await panelList(userDataDir)).panels.filter((panel) =>
              panel.id.startsWith("terminal-")
            ).length,
          { timeout: 15_000 }
        )
        .toBe(1);

      const origin = await bootstrapParentAgent(userDataDir);

      // 设置页：开启两个预设（即时偏好）。
      await win.keyboard.press(SETTINGS_ACCELERATOR);
      await expect(win.locator('[role="dialog"]')).toBeVisible({
        timeout: 10_000,
      });
      await win
        .locator('[data-testid="settings-nav-plugin-pier.agent-splits"]')
        .click();
      const switches = win.getByRole("switch");
      await expect(switches).toHaveCount(5);
      await switches.nth(3).click();
      await expect(switches.nth(3)).toBeChecked();
      await switches.nth(4).click();
      await expect(switches.nth(4)).toBeChecked();
      await win.keyboard.press("Escape");
      await expect(win.locator('[role="dialog"]')).toHaveCount(0);

      const screenArgs = (
        userDataDir2: string,
        child: {
          runtime: { bootId: string; generation: number; runtimeId: string };
        }
      ): string => {
        const raw = runPierCli(
          userDataDir2,
          [
            "agents",
            "screen",
            "--boot",
            child.runtime.bootId,
            "--runtime",
            child.runtime.runtimeId,
            "--generation",
            String(child.runtime.generation),
          ],
          origin
        );
        const screenData = raw.json?.data as
          | { screen?: { text?: string } }
          | undefined;
        return String(screenData?.screen?.text ?? "");
      };

      // claudeTeams：env + 参数注入真实 spawn。
      const claudeChild = runPierCli(
        userDataDir,
        ["agents", "start", "claude", "--stdin"],
        origin,
        "只回复 OK"
      );
      expect(claudeChild.json?.ok, claudeChild.stderr).toBe(true);
      const claudeData = claudeChild.json?.data as unknown as {
        runtime: { bootId: string; generation: number; runtimeId: string };
      };
      await expect
        .poll(
          () => {
            const text = screenArgs(userDataDir, claudeData);
            return (
              text.includes("TEAMS=1") &&
              text.includes("ARGS:--teammate-mode auto")
            );
          },
          { timeout: 20_000 }
        )
        .toBe(true);

      // opencodeOmo：shadow 配置落盘 + 端口/目录注入。
      const omoChild = runPierCli(
        userDataDir,
        ["agents", "start", "opencode", "--stdin"],
        origin,
        "只回复 OK"
      );
      expect(omoChild.json?.ok, omoChild.stderr).toBe(true);
      const omoData = omoChild.json?.data as unknown as {
        runtime: { bootId: string; generation: number; runtimeId: string };
      };
      const omoDeadline = Date.now() + 30_000;
      let omoText = "";
      while (Date.now() < omoDeadline) {
        omoText = screenArgs(userDataDir, omoData);
        if (
          omoText.includes("OMO_PORT=4096") &&
          omoText.includes("ARGS:--port 4096") &&
          omoText.includes("omo-config")
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      // 脚本自报标签为 OMO_PORT（承载 env OPENCODE_PORT 的值）。
      expect(omoText, `omo viewport: ${JSON.stringify(omoText)}`).toContain(
        "OMO_PORT=4096"
      );
      const shadowConfig = JSON.parse(
        readFileSync(
          join(
            userDataDir,
            "plugins",
            "work",
            "pier.agent-splits",
            "omo-config",
            "config.json"
          ),
          "utf8"
        )
      ) as { plugin?: string[]; tmux_visualization?: boolean };
      expect(shadowConfig.plugin).toContain("oh-my-openagent");
      expect(shadowConfig.tmux_visualization).toBe(true);

      // 负例：预设关闭后，新 spawn 不再注入。
      await win.keyboard.press(SETTINGS_ACCELERATOR);
      await expect(win.locator('[role="dialog"]')).toBeVisible({
        timeout: 10_000,
      });
      await win
        .locator('[data-testid="settings-nav-plugin-pier.agent-splits"]')
        .click();
      const switchesOff = win.getByRole("switch");
      await expect(switchesOff).toHaveCount(5);
      await switchesOff.nth(3).click();
      await switchesOff.nth(4).click();
      await win.keyboard.press("Escape");
      await expect(win.locator('[role="dialog"]')).toHaveCount(0);

      const plainChild = runPierCli(
        userDataDir,
        ["agents", "start", "claude", "--stdin"],
        origin,
        "只回复 OK"
      );
      expect(plainChild.json?.ok, plainChild.stderr).toBe(true);
      const plainData = plainChild.json?.data as unknown as {
        runtime: { bootId: string; generation: number; runtimeId: string };
      };
      await expect
        .poll(
          () => {
            const text = screenArgs(userDataDir, plainData);
            return text.includes("ARGS:") && !text.includes("teammate-mode");
          },
          { timeout: 20_000 }
        )
        .toBe(true);
      expect(screenArgs(userDataDir, plainData)).not.toContain("TEAMS=1");
    })();

    return done.finally(async () => {
      await app.close().catch(() => undefined);
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      restoreWorkspace();
    });
  });
});
