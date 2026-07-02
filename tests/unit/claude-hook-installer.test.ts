import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installClaudeHooks,
  uninstallClaudeHooks,
  withoutPierClaudeHooks,
  withPierClaudeHooks,
} from "../../src/main/services/agents/integrations/claude.ts";

const MARK = "PIER_AGENT_HOOK_PORT";

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

describe("withPierClaudeHooks", () => {
  it("为 13 个 Claude hook 事件各注入一条 pier 命令", () => {
    const next = withPierClaudeHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionRequest",
      "PermissionDenied",
      "PreCompact",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    // 不安装 Notification：它覆盖 idle_prompt/auth_success 等噪声,
    // 权限等待用专用的 PermissionRequest 事件。
    expect(hooks.Notification).toBeUndefined();
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain("$PIER_PANEL_ID");
      expect(cmd).toContain("$PIER_WINDOW_ID");
    }
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierClaudeHooks({});
    const twice = withPierClaudeHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      model: "opus",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const next = withPierClaudeHooks(user);
    expect(next.model).toBe("opus");
    const stop = (next.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });
});

describe("withoutPierClaudeHooks", () => {
  it("只移除 pier 条目, 保留用户 hook", () => {
    const user = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierClaudeHooks(withPierClaudeHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });
});

describe("install/uninstallClaudeHooks (文件 IO)", () => {
  it("往不存在的 settings.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await installClaudeHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallClaudeHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ not json", "utf8");
    await installClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    const original = '{"model":"opus"}';
    await writeFile(path, original, "utf8");
    await uninstallClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await installClaudeHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
