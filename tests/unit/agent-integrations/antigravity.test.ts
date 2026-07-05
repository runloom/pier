import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  antigravityIntegration,
  installAntigravityHooks,
  uninstallAntigravityHooks,
  withoutPierAntigravityHooks,
  withPierAntigravityHooks,
} from "../../../src/main/services/agents/integrations/antigravity.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const ALL_EVENTS = ["PreInvocation", "PostToolUse", "Stop"];

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

describe("withPierAntigravityHooks", () => {
  it("为 3 个 Antigravity hook 事件各注入一条 pier 命令", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("CRITICAL: 绝不安装 PreToolUse 键（Antigravity 用它做权限阻塞判定, cmux#4768）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(Object.keys(hooks)).not.toContain("PreToolUse");
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("不安装 PostInvocation（与 Stop 语义重叠，避免双 Stop）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.PostInvocation).toBeUndefined();
  });

  it("不安装 Notification（无确证信源支撑 PermissionRequest 映射）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.Notification).toBeUndefined();
  });

  it("PostToolUse 事件写 matcher '*'，其余事件不写 matcher", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }>; matcher?: string }>
    >;
    expect(hooks.PostToolUse?.[0]?.matcher).toBe("*");
    expect(hooks.PreInvocation?.[0]?.matcher).toBeUndefined();
    expect(hooks.Stop?.[0]?.matcher).toBeUndefined();
  });

  it("PreInvocation 映射到 pierEvent PromptSubmit，PostToolUse 映射到 ToolComplete，Stop 映射到 Stop", () => {
    const next = withPierAntigravityHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    expect(hooks.PreInvocation?.[0]?.hooks[0]?.command).toContain(
      '"PromptSubmit"'
    );
    expect(hooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toContain('"Stop"');
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierAntigravityHooks({});
    const twice = withPierAntigravityHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook、顶层配置，以及用户自建的 PreToolUse 条目", () => {
    const user = {
      model: "antigravity-1",
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "user-permission-gate" }] },
        ],
        SomeOtherEvent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const next = withPierAntigravityHooks(user);
    expect(next.model).toBe("antigravity-1");
    const hooks = next.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    // 用户的 PreToolUse 条目必须原封不动保留，pier 从不写这个键。
    const preToolUse = hooks.PreToolUse ?? [];
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0]?.hooks[0]?.command).toBe("user-permission-gate");
    // 无关键名保持原样，不会被 pier 条目追加。
    const other = hooks.SomeOtherEvent ?? [];
    expect(other).toHaveLength(1);
    expect(other[0]?.hooks[0]?.command).toBe("say done");
  });
});

describe("withoutPierAntigravityHooks", () => {
  it("只移除 pier 条目，保留用户 hook（包括用户的 PreToolUse）", () => {
    const user = {
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "user-permission-gate" }] },
        ],
        SomeOtherEvent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierAntigravityHooks(withPierAntigravityHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(
      expect.arrayContaining(["user-permission-gate", "say done"])
    );
    expect(cmds).toHaveLength(2);
    const hooks = cleaned.hooks as Record<string, unknown>;
    expect(hooks.PreInvocation).toBeUndefined();
    expect(hooks.PostToolUse).toBeUndefined();
    expect((hooks.PreToolUse as unknown[]).length).toBe(1);
  });
});

describe("install/uninstallAntigravityHooks (文件 IO)", () => {
  it("往不存在的 hooks.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await installAntigravityHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    expect(
      (installed.hooks as Record<string, unknown>).PreToolUse
    ).toBeUndefined();
    await uninstallAntigravityHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 hooks.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, "{ not json", "utf8");
    await installAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    const original = '{"model":"antigravity-1"}';
    await writeFile(path, original, "utf8");
    await uninstallAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await installAntigravityHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});

describe("antigravityIntegration.detect()", () => {
  it("返回 boolean（目录/PATH 状态由运行环境决定，此处仅冒烟测试）", () => {
    expect(typeof antigravityIntegration.detect()).toBe("boolean");
  });

  it("integration 元信息符合 spec", () => {
    expect(antigravityIntegration.id).toBe("antigravity");
    expect(antigravityIntegration.capability).toBe("coarse");
  });
});
