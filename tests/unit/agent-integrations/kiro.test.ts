import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_HOOKS_DIR";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-kiro-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  return await import("../../../src/main/services/agents/integrations/kiro.ts");
}

function agentsDir(): string {
  return join(homeDir, ".kiro", "agents");
}

describe("kiroIntegration 契约", () => {
  it("capability 为 full，id 为 kiro", async () => {
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.capability).toBe("full");
    expect(kiroIntegration.id).toBe("kiro");
  });

  it("detect(): ~/.kiro 存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.detect()).toBe(false);
    await mkdir(join(homeDir, ".kiro"), { recursive: true });
    expect(kiroIntegration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 kiro 二进制时即使无 ~/.kiro 也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kiro-bin-"));
    await writeFile(join(dir, "kiro"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.detect()).toBe(true);
  });
});

describe("withPierKiroHooks / withoutPierKiroHooks (纯函数)", () => {
  it("扁平数组 schema：hooks.<event> 直接是 {command, matcher?} 数组", async () => {
    const { withPierKiroHooks } = await loadIntegration();
    const next = withPierKiroHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ command: string; matcher?: string }>
    >;
    expect(Array.isArray(hooks.agentSpawn)).toBe(true);
    expect(hooks.agentSpawn?.[0]).not.toHaveProperty("hooks");
    expect(typeof hooks.agentSpawn?.[0]?.command).toBe("string");
  });

  it("五事件齐全，工具事件带 matcher，其余不带", async () => {
    const { withPierKiroHooks } = await loadIntegration();
    const next = withPierKiroHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ command: string; matcher?: string }>
    >;
    for (const evt of ["agentSpawn", "userPromptSubmit", "stop"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(hooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    for (const evt of ["preToolUse", "postToolUse"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(hooks[evt]?.[0]?.matcher).toBe("*");
    }
  });

  it("命令内容从 stdin payload 抽取 session_id 并上报正确事件名", async () => {
    const { withPierKiroHooks } = await loadIntegration();
    const next = withPierKiroHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ command: string; matcher?: string }>
    >;
    const stopCmd = hooks.stop?.[0]?.command ?? "";
    expect(stopCmd).toContain("session_id");
    expect(stopCmd).toContain("sessionId");
    expect(stopCmd).toContain(MARK);
    expect(stopCmd).toContain('"kiro"');
    expect(stopCmd).toContain('"Stop"');
    expect(hooks.agentSpawn?.[0]?.command).toContain('"SessionStart"');
    expect(hooks.userPromptSubmit?.[0]?.command).toContain('"PromptSubmit"');
    expect(hooks.preToolUse?.[0]?.command).toContain('"ToolStart"');
    expect(hooks.postToolUse?.[0]?.command).toContain('"ToolComplete"');
  });

  it("幂等：重复注入不产生重复条目", async () => {
    const { withPierKiroHooks } = await loadIntegration();
    const once = withPierKiroHooks({});
    const twice = withPierKiroHooks(once);
    const hooks = twice.hooks as Record<string, unknown[]>;
    expect(hooks.stop).toHaveLength(1);
  });

  it("保留用户已有的无关 hook 条目与顶层配置", async () => {
    const { withPierKiroHooks } = await loadIntegration();
    const user = {
      name: "my-agent",
      hooks: { stop: [{ command: "say done" }] },
    };
    const next = withPierKiroHooks(user);
    expect(next.name).toBe("my-agent");
    const hooks = next.hooks as Record<string, Array<{ command: string }>>;
    expect(hooks.stop).toHaveLength(2);
    expect(hooks.stop?.[0]?.command).toBe("say done");
  });

  it("withoutPierKiroHooks 只移除 pier 条目，保留用户 hook", async () => {
    const { withPierKiroHooks, withoutPierKiroHooks } = await loadIntegration();
    const user = { hooks: { stop: [{ command: "say done" }] } };
    const installed = withPierKiroHooks(user);
    const cleaned = withoutPierKiroHooks(installed);
    const hooks = cleaned.hooks as Record<string, unknown[]>;
    expect(hooks.stop).toEqual([{ command: "say done" }]);
    expect(hooks.agentSpawn).toBeUndefined();
  });

  it("withoutPierKiroHooks 无 pier 条目时原样返回输入引用", async () => {
    const { withoutPierKiroHooks } = await loadIntegration();
    const config = { hooks: { stop: [{ command: "say done" }] } };
    expect(withoutPierKiroHooks(config)).toBe(config);
  });
});

describe("install/uninstallKiroHooks (文件 IO, 对目录下所有既存 *.json 注入)", () => {
  it("对 ~/.kiro/agents/ 下所有既存 agent 文件注入", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(
      join(agentsDir(), "general-assistant.json"),
      JSON.stringify({ name: "general-assistant" }),
      "utf8"
    );
    await writeFile(
      join(agentsDir(), "code-reviewer.json"),
      JSON.stringify({ name: "code-reviewer" }),
      "utf8"
    );
    const { installKiroHooks } = await loadIntegration();
    await installKiroHooks();
    for (const file of ["general-assistant.json", "code-reviewer.json"]) {
      const parsed = JSON.parse(
        await readFile(join(agentsDir(), file), "utf8")
      );
      expect(parsed.hooks.stop).toHaveLength(1);
    }
  });

  it("目录不存在时 install 是 no-op（不主动新建 agent 文件）", async () => {
    const { installKiroHooks } = await loadIntegration();
    await expect(installKiroHooks()).resolves.not.toThrow();
    const { existsSync } = await import("node:fs");
    expect(existsSync(agentsDir())).toBe(false);
  });

  it("卸载对所有文件移除 pier 条目, 保留用户其他配置", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(
      join(agentsDir(), "general-assistant.json"),
      JSON.stringify({ name: "general-assistant" }),
      "utf8"
    );
    const { installKiroHooks, uninstallKiroHooks } = await loadIntegration();
    await installKiroHooks();
    await uninstallKiroHooks();
    const parsed = JSON.parse(
      await readFile(join(agentsDir(), "general-assistant.json"), "utf8")
    );
    expect(parsed.name).toBe("general-assistant");
    expect(parsed.hooks).toEqual({});
  });

  it("单个文件损坏不影响其他文件安装", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(join(agentsDir(), "broken.json"), "{ not json", "utf8");
    await writeFile(
      join(agentsDir(), "ok.json"),
      JSON.stringify({ name: "ok" }),
      "utf8"
    );
    const { installKiroHooks } = await loadIntegration();
    await installKiroHooks();
    expect(await readFile(join(agentsDir(), "broken.json"), "utf8")).toBe(
      "{ not json"
    );
    const parsed = JSON.parse(
      await readFile(join(agentsDir(), "ok.json"), "utf8")
    );
    expect(parsed.hooks.stop).toHaveLength(1);
  });

  it("重复安装第二次不改变文件字节", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(
      join(agentsDir(), "a.json"),
      JSON.stringify({ name: "a" }),
      "utf8"
    );
    const { installKiroHooks } = await loadIntegration();
    await installKiroHooks();
    const afterFirst = await readFile(join(agentsDir(), "a.json"), "utf8");
    await installKiroHooks();
    expect(await readFile(join(agentsDir(), "a.json"), "utf8")).toBe(
      afterFirst
    );
  });

  it("忽略非 .json 文件", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(join(agentsDir(), "README.md"), "# notes", "utf8");
    const { installKiroHooks } = await loadIntegration();
    await expect(installKiroHooks()).resolves.not.toThrow();
    expect(await readFile(join(agentsDir(), "README.md"), "utf8")).toBe(
      "# notes"
    );
  });
});
