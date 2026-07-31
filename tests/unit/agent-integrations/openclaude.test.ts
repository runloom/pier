import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-openclaude-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/openclaude.ts"
  );
  return mod.openclaudeIntegration;
}

function configPath(): string {
  return join(homeDir, ".openclaude", "settings.json");
}

describe("openclaudeIntegration", () => {
  it("id 为 openclaude", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("openclaude");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await wf(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("只为有可信状态语义的 12 个 OpenClaude 事件注入命令，无 matcher", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;
    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "PostCompact",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ];
    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;
    for (const evt of expectedEvents) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    expect(hooks.Notification).toBeUndefined();
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.PermissionDenied).toBeUndefined();
    expect(hooks.Elicitation).toBeUndefined();
    expect(hooks.ElicitationResult).toBeUndefined();
    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"openclaude"');
    }
    const ups = (
      installed.hooks as Record<
        string,
        Array<{ hooks: Array<{ command: string }> }>
      >
    ).UserPromptSubmit?.[0]?.hooks?.[0]?.command;
    // OpenClaude 只消费其公开 hook 输入；不复制 Claude 专属 sessionTitle 双写。
    const hooksDirRef = ["$", "{PIER_AGENT_HOOKS_DIR}"].join("");
    expect(ups).not.toContain(`${hooksDirRef}/derive-claude-session-title`);
    expect(ups).toContain(`${hooksDirRef}/extract-stdin-meta`);
    expect(ups).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("不安装缺少完整结果闭环的 waiting，PreToolUse 只开始工具", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const acceptedCommand = hooks.PreToolUse?.[0]?.hooks?.[0]?.command ?? "";
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.Elicitation).toBeUndefined();
    expect(hooks.ElicitationResult).toBeUndefined();

    const root = await mkdtemp(join(tmpdir(), "pier-openclaude-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      prompt_id: "prompt-1",
      session_id: "session-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
    });
    const acceptedResult = spawnSync("/bin/sh", ["-c", acceptedCommand], {
      env,
      input: payload,
    });
    expect(acceptedResult.status, acceptedResult.stderr.toString()).toBe(0);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        agent: "openclaude",
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        sessionId: "session-1",
        toolUseId: "tool-1",
        turnId: "prompt-1",
        v: 3,
      },
    ]);
  }, 15_000);

  it("幂等：重复安装不产生重复条目", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const once = JSON.parse(await readFile(configPath(), "utf8"));
    await integration.install();
    const twice = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("重复安装第二次不改变文件字节", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const afterFirst = await readFile(configPath(), "utf8");
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(afterFirst);
  });

  it("保留用户已有的无关 hook 与顶层配置", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "opus",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("opus");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    const original = '{"model":"opus"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
