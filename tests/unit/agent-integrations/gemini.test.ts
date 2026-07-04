import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installGeminiHooks,
  uninstallGeminiHooks,
  withoutPierGeminiHooks,
  withPierGeminiHooks,
} from "../../../src/main/services/agents/integrations/gemini.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const PERMISSION_REQUEST_RE = /PermissionRequest/i;

const GEMINI_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "BeforeTool",
  "AfterTool",
];

function hookMatchers(settings: Record<string, unknown>) {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{
      hooks: Array<{ command: string; timeout?: number }>;
      matcher?: string;
    }>
  >;
  return hooks;
}

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = hookMatchers(settings);
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

function allHookEntries(
  settings: Record<string, unknown>
): Array<{ command: string; timeout?: number }> {
  const hooks = hookMatchers(settings);
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks);
}

describe("withPierGeminiHooks", () => {
  it("为 6 个 Gemini hook 事件各注入一条 pier 命令", () => {
    const next = withPierGeminiHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of GEMINI_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it('BeforeTool / AfterTool 条目携带 matcher: ""', () => {
    const next = withPierGeminiHooks({});
    const hooks = hookMatchers(next);
    expect(hooks.BeforeTool?.[0]?.matcher).toBe("");
    expect(hooks.AfterTool?.[0]?.matcher).toBe("");
  });

  it("所有注入的 hook 条目 timeout 字段严格等于 10000（毫秒陷阱）", () => {
    const next = withPierGeminiHooks({});
    const entries = allHookEntries(next);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.timeout).toBe(10_000);
    }
  });

  it("不存在 PermissionRequest 类原生事件键；hooks 下只有 6 个指定事件键", () => {
    const next = withPierGeminiHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    const keys = Object.keys(hooks);
    expect(keys).toHaveLength(GEMINI_EVENTS.length);
    for (const key of keys) {
      expect(key).not.toMatch(PERMISSION_REQUEST_RE);
    }
    expect(keys.sort()).toEqual([...GEMINI_EVENTS].sort());
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierGeminiHooks({});
    const twice = withPierGeminiHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      contextFileName: "GEMINI.md",
      hooks: {
        AfterAgent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const next = withPierGeminiHooks(user);
    expect(next.contextFileName).toBe("GEMINI.md");
    const afterAgent = (next.hooks as Record<string, unknown[]>).AfterAgent;
    expect(afterAgent).toHaveLength(2);
  });
});

describe("withoutPierGeminiHooks", () => {
  it("只移除 pier 条目, 保留用户 hook", () => {
    const user = {
      hooks: {
        AfterAgent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierGeminiHooks(withPierGeminiHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });
});

describe("install/uninstallGeminiHooks (文件 IO)", () => {
  it("往不存在的 settings.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await installGeminiHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallGeminiHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ not json", "utf8");
    await installGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    const original = '{"contextFileName":"GEMINI.md"}';
    await writeFile(path, original, "utf8");
    await uninstallGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await installGeminiHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
