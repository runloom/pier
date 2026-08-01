import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  crushIntegration,
  installCrushHooks,
  uninstallCrushHooks,
  withoutPierCrushHooks,
  withPierCrushHooks,
} from "../../../src/main/services/agents/integrations/crush.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

interface CrushHookEntry {
  command: string;
  matcher?: string;
  name?: string;
  timeout?: number;
}

describe("withPierCrushHooks", () => {
  it("PreToolUse 只有策略前置事实，安装不得生成五态 agentEvent", () => {
    const next = withPierCrushHooks({});
    const hooks = (next.hooks ?? {}) as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(0);
    expect(crushIntegration.runtime.emittedMappings).toEqual([]);
  });

  it("安装路径仅清理历史 Pier 条目，保留用户扁平 PreToolUse 条目", () => {
    const next = withPierCrushHooks({
      hooks: {
        PreToolUse: [
          {
            command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy-pre-tool`,
          },
          { command: "echo user-defined", name: "user-hook" },
        ],
      },
    });
    const hooks = next.hooks as Record<string, CrushHookEntry[]>;
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toEqual([
      { command: "echo user-defined", name: "user-hook" },
    ]);
  });

  it("不再装 tool_call_before/tool_call_after（官方文档不存在这两个事件名）", () => {
    const next = withPierCrushHooks({});
    const hooks = (next.hooks ?? {}) as Record<string, unknown>;
    expect(hooks.tool_call_before).toBeUndefined();
    expect(hooks.tool_call_after).toBeUndefined();
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCrushHooks({});
    const twice = withPierCrushHooks(once);
    const hooks = (twice.hooks ?? {}) as Record<string, CrushHookEntry[]>;
    expect(hooks.PreToolUse).toBeUndefined();
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
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse.some((e) => e.command === "echo user-defined")).toBe(
      true
    );
    expect(preToolUse.some((e) => e.command.includes(MARK))).toBe(false);
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
    const hooks = (cleaned.hooks ?? {}) as Record<string, unknown>;
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { PreToolUse: [{ command: "echo user-defined" }] } };
    expect(withoutPierCrushHooks(user)).toBe(user);
  });
});

describe("install/uninstallCrushHooks (文件 IO)", () => {
  it("不存在配置时安装保持无副作用，不创建 PreToolUse 映射", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    await installCrushHooks(path);
    await expect(readFile(path, "utf8")).rejects.toThrow();
    await uninstallCrushHooks(path);
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

  it("重复安装只清理历史映射且第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-crush-test-"));
    const path = join(dir, "crush.json");
    await writeFile(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ command: `echo \${${MARK}}; old-pier` }],
        },
      }),
      "utf8"
    );
    await installCrushHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCrushHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
