import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installCursorHooks,
  uninstallCursorHooks,
  withoutPierCursorHooks,
  withPierCursorHooks,
} from "../../../src/main/services/agents/integrations/cursor.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const ALL_EVENTS = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeShellExecution",
  "beforeMCPExecution",
  "afterShellExecution",
  "afterMCPExecution",
  "afterAgentResponse",
  "subagentStart",
  "subagentStop",
  "stop",
  "sessionEnd",
];

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ command: string }>
  >;
  return Object.values(hooks)
    .flat()
    .map((h) => h.command);
}

describe("withPierCursorHooks", () => {
  it("为全部 14 个 cursor hook 事件各注入一条 pier 命令", () => {
    const next = withPierCursorHooks({});
    const hooks = next.hooks as Record<string, Array<{ command: string }>>;
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("schema 形状：command 直接在定义对象上（非嵌套 hooks 数组）", () => {
    const next = withPierCursorHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ command: string; timeout?: number }>
    >;
    const entry = hooks.sessionStart?.[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.command).toBe("string");
    expect(entry?.timeout).toBe(10);
    expect((entry as { hooks?: unknown })?.hooks).toBeUndefined();
  });

  it("顶层写入 version:1（无已有 version 时）", () => {
    const next = withPierCursorHooks({});
    expect(next.version).toBe(1);
  });

  it("保留已有的 version 值", () => {
    const next = withPierCursorHooks({ version: 1, foo: "bar" });
    expect(next.version).toBe(1);
    expect(next.foo).toBe("bar");
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCursorHooks({});
    const twice = withPierCursorHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      hooks: {
        stop: [{ command: "say done" }],
      },
      version: 1,
    };
    const next = withPierCursorHooks(user);
    const stop = (next.hooks as Record<string, unknown[]>).stop;
    expect(stop).toHaveLength(2);
  });
});

describe("withoutPierCursorHooks", () => {
  it("只移除 pier 条目，保留用户 hook", () => {
    const user = {
      hooks: {
        stop: [{ command: "say done" }],
      },
      version: 1,
    };
    const cleaned = withoutPierCursorHooks(withPierCursorHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).sessionStart
    ).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { stop: [{ command: "say done" }] } };
    expect(withoutPierCursorHooks(user)).toBe(user);
  });
});

describe("install/uninstallCursorHooks (文件 IO)", () => {
  it("往不存在的 hooks.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await installCursorHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(installed.version).toBe(1);
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallCursorHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 hooks.json 不被覆盖（安装静默放弃）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, "{ not json", "utf8");
    await installCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

describe("无变化不落盘", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    const original = '{"version":1}';
    await writeFile(path, original, "utf8");
    await uninstallCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await installCursorHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
