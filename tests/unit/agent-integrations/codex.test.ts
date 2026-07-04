import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codexHomeDir,
  installCodexHooks,
  uninstallCodexHooks,
  withoutPierCodexHooks,
  withPierCodexHooks,
} from "../../../src/main/services/agents/integrations/codex.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "Stop",
];

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

function matcherEntries(
  settings: Record<string, unknown>
): Record<string, unknown>[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Record<string, unknown>[]
  >;
  return Object.values(hooks).flat();
}

describe("withPierCodexHooks", () => {
  it("为 8 个 Codex hook 事件各注入一条 pier 命令", () => {
    const next = withPierCodexHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of CODEX_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("所有事件条目均不写 matcher 字段", () => {
    const next = withPierCodexHooks({});
    for (const entry of matcherEntries(next)) {
      expect("matcher" in entry).toBe(false);
      expect(entry.matcher).toBeUndefined();
    }
  });

  it("不安装 SessionEnd（Codex 上游无此 hook 事件）", () => {
    const next = withPierCodexHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.SessionEnd).toBeUndefined();
    expect("SessionEnd" in hooks).toBe(false);
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCodexHooks({});
    const twice = withPierCodexHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      someTopLevelKey: "keep-me",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        SomeOtherNativeEvent: [
          { hooks: [{ type: "command", command: "echo other" }] },
        ],
      },
    };
    const next = withPierCodexHooks(user);
    expect(next.someTopLevelKey).toBe("keep-me");
    const hooks = next.hooks as Record<string, unknown[]>;
    expect(hooks.Stop).toHaveLength(2);
    expect(hooks.SomeOtherNativeEvent).toHaveLength(1);
  });
});

describe("withoutPierCodexHooks", () => {
  it("只移除 pier 条目, 保留用户 hook", () => {
    const user = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierCodexHooks(withPierCodexHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });
});

describe("codexHomeDir", () => {
  const original = process.env.CODEX_HOME;

  afterEach(() => {
    if (original === undefined) {
      process.env.CODEX_HOME = undefined;
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = original;
    }
  });

  it("未设置时默认 ~/.codex", () => {
    delete process.env.CODEX_HOME;
    expect(codexHomeDir()).toBe(join(homedir(), ".codex"));
  });

  it("空字符串时默认 ~/.codex", () => {
    process.env.CODEX_HOME = "";
    expect(codexHomeDir()).toBe(join(homedir(), ".codex"));
  });

  it("以 ~ 开头时展开为 homedir()", () => {
    process.env.CODEX_HOME = "~/custom-codex-home";
    expect(codexHomeDir()).toBe(join(homedir(), "custom-codex-home"));
  });

  it("单独的 ~ 展开为 homedir()", () => {
    process.env.CODEX_HOME = "~";
    expect(codexHomeDir()).toBe(homedir());
  });

  it("绝对路径原样使用", () => {
    process.env.CODEX_HOME = "/opt/codex-home";
    expect(codexHomeDir()).toBe("/opt/codex-home");
  });
});

describe("install/uninstallCodexHooks (文件 IO)", () => {
  it("往不存在的 hooks.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-test-"));
    const path = join(dir, "hooks.json");
    await installCodexHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallCodexHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 hooks.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, "{ not json", "utf8");
    await installCodexHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("目录存在但 hooks.json 尚不存在时, 安装仍正常创建文件(seed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-test-"));
    const path = join(dir, "hooks.json");
    // 明确不预先创建 hooks.json：只有目录存在。
    await installCodexHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBe(CODEX_EVENTS.length);
    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
    }
  });
});

describe("安装遗留清理（spec 事件表更迭后清理旧 pier 条目）", () => {
  it("清理上一版装过但已从 spec 移除的事件下的 pier 条目", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-legacy-"));
    const path = join(dir, "hooks.json");
    // 模拟上一版装过 SubagentStart/SubagentStop 的遗留:
    // 用户其他工具的条目要保留, 只清 pier 自家的。
    const legacyConfig = {
      hooks: {
        SubagentStart: [
          {
            hooks: [
              {
                command: `echo test && ${MARK}=1 curl -X POST http://x/agent-event`,
                timeout: 5,
                type: "command",
              },
            ],
          },
          {
            hooks: [{ command: "keep-me", timeout: 5, type: "command" }],
          },
        ],
        SubagentStop: [
          {
            hooks: [
              {
                command: `${MARK} sneaky pier entry`,
                timeout: 5,
                type: "command",
              },
            ],
          },
        ],
      },
    };
    await writeFile(path, JSON.stringify(legacyConfig, null, 2), "utf8");
    await installCodexHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;
    // pier 从 SubagentStart 里被清理, 用户其他条目保留;
    // SubagentStop 全部是 pier 条目 → 键被清空并删除。
    expect(hooks.SubagentStart).toHaveLength(1);
    expect("SubagentStop" in hooks).toBe(false);
    // 当前 spec 事件都装到঩了。
    for (const evt of CODEX_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-test-"));
    const path = join(dir, "hooks.json");
    const original = '{"someKey":"value"}';
    await writeFile(path, original, "utf8");
    await uninstallCodexHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-test-"));
    const path = join(dir, "hooks.json");
    await installCodexHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCodexHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});

describe("CODEX_HOME 环境变量解析集成", () => {
  const original = process.env.CODEX_HOME;

  beforeEach(() => {
    process.env.CODEX_HOME = undefined;
    delete process.env.CODEX_HOME;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = original;
    }
  });

  it("installCodexHooks 不传路径时, 从 CODEX_HOME 解析并写入 hooks.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-codex-env-test-"));
    process.env.CODEX_HOME = dir;
    await installCodexHooks();
    const expectedPath = join(dir, "hooks.json");
    const installed = JSON.parse(await readFile(expectedPath, "utf8"));
    expect(hookCommands(installed).length).toBe(CODEX_EVENTS.length);
  });
});
