import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installCrushHooks,
  uninstallCrushHooks,
  withoutPierCrushHooks,
  withPierCrushHooks,
  withPierCrushTerminalChrome,
} from "../../../src/main/services/agents/integrations/crush.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

interface CrushHookEntry {
  command: string;
  matcher?: string;
  name?: string;
  timeout?: number;
}

describe("withPierCrushHooks", () => {
  it("为 hooks.PreToolUse 写入一条 pier 命令条目（官方仅支持这一个事件）", () => {
    const next = withPierCrushHooks({});
    const hooks = next.hooks as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]?.command).toContain(MARK);
  });

  it("schema 形状：PreToolUse 是对象数组，条目无 type 字段、无内层 hooks 包装", () => {
    const next = withPierCrushHooks({});
    const hooks = next.hooks as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    const entry = preToolUse[0] as unknown as Record<string, unknown>;
    expect(Array.isArray(preToolUse)).toBe(true);
    expect(typeof entry.command).toBe("string");
    expect("type" in entry).toBe(false);
    expect("hooks" in entry).toBe(false);
  });

  it("不再装 tool_call_before/tool_call_after（官方文档不存在这两个事件名）", () => {
    const next = withPierCrushHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.tool_call_before).toBeUndefined();
    expect(hooks.tool_call_after).toBeUndefined();
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCrushHooks({});
    const twice = withPierCrushHooks(once);
    const hooks = twice.hooks as Record<string, CrushHookEntry[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it("保留用户已有的其他 PreToolUse 条目与顶层配置", () => {
    const user = {
      hooks: {
        PreToolUse: [{ command: "echo user-defined", name: "user-hook" }],
      },
      model: "crush-1",
    };
    const next = withPierCrushHooks(user);
    expect(next.model).toBe("crush-1");
    const hooks = next.hooks as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse.some((e) => e.command === "echo user-defined")).toBe(
      true
    );
    expect(preToolUse.some((e) => e.command.includes(MARK))).toBe(true);
  });
});

describe("withPierCrushTerminalChrome", () => {
  it("sets options.tui.transparent=true when unset", () => {
    const next = withPierCrushTerminalChrome({});
    const options = next.options as Record<string, unknown>;
    const tui = options.tui as Record<string, unknown>;
    expect(tui.transparent).toBe(true);
  });

  it("preserves explicit user transparent=false", () => {
    const next = withPierCrushTerminalChrome({
      options: { tui: { transparent: false } },
    });
    const options = next.options as Record<string, unknown>;
    const tui = options.tui as Record<string, unknown>;
    expect(tui.transparent).toBe(false);
  });

  it("keeps hooks transform composable", () => {
    const next = withPierCrushTerminalChrome(withPierCrushHooks({}));
    const hooks = next.hooks as Record<string, CrushHookEntry[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
    const options = next.options as Record<string, unknown>;
    const tui = options.tui as Record<string, unknown>;
    expect(tui.transparent).toBe(true);
  });
});

describe("withoutPierCrushHooks", () => {
  it("只移除 pier 条目，保留用户条目", () => {
    const user = {
      hooks: {
        PreToolUse: [{ command: "echo user-defined" }],
      },
    };
    const installed = withPierCrushHooks(user);
    const cleaned = withoutPierCrushHooks(installed);
    const hooks = cleaned.hooks as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]?.command).toBe("echo user-defined");
  });

  it("pier 条目移除后为空数组时删除 PreToolUse 键", () => {
    const cleaned = withoutPierCrushHooks(withPierCrushHooks({}));
    const hooks = cleaned.hooks as Record<string, unknown>;
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { PreToolUse: [{ command: "echo user-defined" }] } };
    expect(withoutPierCrushHooks(user)).toBe(user);
  });
});

describe("install/uninstallCrushHooks (文件 IO)", () => {
  it("往不存在的 crush.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    await installCrushHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(installed.hooks.PreToolUse[0].command).toContain(MARK);
    await uninstallCrushHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(cleaned.hooks?.PreToolUse ?? []).toEqual([]);
  });

  it("已损坏的 crush.json 不被覆盖（安装静默放弃）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    await writeFile(path, "{ not json", "utf8");
    await installCrushHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

describe("无变化不落盘", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    const original =
      '{"hooks":{"PreToolUse":[{"command":"echo user-defined"}]}}';
    await writeFile(path, original, "utf8");
    await uninstallCrushHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    await installCrushHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCrushHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
