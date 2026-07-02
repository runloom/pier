import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  installCopilotHooks,
  uninstallCopilotHooks,
  withoutPierCopilotHooks,
  withPierCopilotHooks,
} from "../../../src/main/services/agents/integrations/copilot.ts";

const MARK = "PIER_AGENT_HOOK_PORT";

const ALL_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "agentStop",
  "permissionRequest",
  "subagentStart",
  "subagentStop",
  "errorOccurred",
];

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ bash: string }>
  >;
  return Object.values(hooks)
    .flat()
    .map((h) => h.bash);
}

describe("withPierCopilotHooks", () => {
  it("为全部 10 个 copilot hook 事件各注入一条 pier 命令", () => {
    const next = withPierCopilotHooks({});
    const hooks = next.hooks as Record<string, Array<{ bash: string }>>;
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain("$PIER_PANEL_ID");
      expect(cmd).toContain("$PIER_WINDOW_ID");
    }
  });

  it("schema 形状：bash 字段 + timeoutSec + type:command", () => {
    const next = withPierCopilotHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ bash: string; timeoutSec?: number; type?: string }>
    >;
    const entry = hooks.sessionStart?.[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.bash).toBe("string");
    expect(entry?.timeoutSec).toBe(5);
    expect(entry?.type).toBe("command");
    expect((entry as { command?: unknown })?.command).toBeUndefined();
    expect((entry as { timeout?: unknown })?.timeout).toBeUndefined();
  });

  it("顶层写入 version:1（无已有 version 时）", () => {
    const next = withPierCopilotHooks({});
    expect(next.version).toBe(1);
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCopilotHooks({});
    const twice = withPierCopilotHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      hooks: {
        agentStop: [{ bash: "say done", type: "command" }],
      },
    };
    const next = withPierCopilotHooks(user);
    const stop = (next.hooks as Record<string, unknown[]>).agentStop;
    expect(stop).toHaveLength(2);
  });
});

describe("withoutPierCopilotHooks", () => {
  it("只移除 pier 条目，保留用户 hook", () => {
    const user = {
      hooks: {
        agentStop: [{ bash: "say done", type: "command" }],
      },
    };
    const cleaned = withoutPierCopilotHooks(withPierCopilotHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).sessionStart
    ).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { agentStop: [{ bash: "say done" }] } };
    expect(withoutPierCopilotHooks(user)).toBe(user);
  });
});

describe("install/uninstallCopilotHooks (文件 IO)", () => {
  it("往不存在的 pier.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await installCopilotHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallCopilotHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 pier.json 不被覆盖（安装静默放弃）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await writeFile(path, "{ not json", "utf8");
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("disableAllHooks=true 时不写入，且发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    const original = JSON.stringify({ disableAllHooks: true });
    await writeFile(path, original, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("无变化不落盘", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    const original = '{"version":1}';
    await writeFile(path, original, "utf8");
    await uninstallCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await installCopilotHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
