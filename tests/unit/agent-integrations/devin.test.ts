import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripJsonComments } from "../../../src/main/services/agents/integrations/devin.ts";

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

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-devin-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/devin.ts"
  );
  return mod.devinIntegration;
}

function configPath(): string {
  return join(homeDir, ".config", "devin", "config.json");
}

describe("stripJsonComments", () => {
  it("剥离行注释与块注释", () => {
    const input = [
      "{",
      "  // leading comment",
      '  "a": 1, /* inline block */',
      '  "b": 2 // trailing',
      "}",
    ].join("\n");
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("不误剥字符串字面量内的 // 与 /* */ 序列", () => {
    const input =
      '{"url": "https://example.com", "note": "a /* not a comment */ b"}';
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      url: "https://example.com",
      note: "a /* not a comment */ b",
    });
  });

  it("正确处理字符串内的转义引号，不提前判定字符串结束", () => {
    const input = String.raw`{"note": "a \" // still string", "b": 2}`;
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({ note: 'a " // still string', b: 2 });
  });

  it("多行块注释保持结构完整", () => {
    const input = ["{", "/*", "multi", "line", "*/", '"a": 1', "}"].join("\n");
    const parsed = JSON.parse(stripJsonComments(input));
    expect(parsed).toEqual({ a: 1 });
  });
});

describe("devinIntegration", () => {
  it("capability 为 full，id 为 devin", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("devin");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("8 个事件各一条命令，全部无 matcher", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "PostCompaction",
      "SessionEnd",
      "PreToolUse",
      "PostToolUse",
      "PermissionRequest",
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

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain("$PIER_PANEL_ID");
      expect(cmd).toContain("$PIER_WINDOW_ID");
      expect(cmd).toContain('\\"agent\\":\\"devin\\"');
    }

    expect(typedHooks.PostCompaction?.[0]?.hooks[0]?.command).toContain(
      '\\"event\\":\\"processing\\"'
    );
    expect(typedHooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      '\\"event\\":\\"PromptSubmit\\"'
    );
  });

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
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "devin-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("devin-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
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

  it("带注释的合法 JSONC 不算损坏，能正常安装（注释在写回后丢失，属预期行为）", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(
      configPath(),
      ["{", "  // user config", '  "model": "devin-1" /* pinned */', "}"].join(
        "\n"
      ),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("devin-1");
    expect(hookCommands(installed).length).toBeGreaterThan(0);
  });

  it("真正损坏（非法 JSON，剥注释后仍不可解析）的配置不被覆盖", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(configPath(), "{ not json // comment", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json // comment");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    const original = '{"model":"devin-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
