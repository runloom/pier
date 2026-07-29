import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HISTORICAL_PIER_COMMAND = `[ -x "\${PIER_AGENT_HOOKS_DIR}/emit" ] && "\${PIER_AGENT_HOOKS_DIR}/emit" "agentEventV2" "kiro" "Stop" "stop" || true`;

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
  it("id 为 kiro", async () => {
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.id).toBe("kiro");
  });

  it("cleanup-only 集成不声明事件映射或 Stop 权威", async () => {
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.runtime).toEqual({
      emittedMappings: [],
      stopAuthority: "none",
    });
  });

  it("detect(): ~/.kiro 存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.detect()).toBe(false);
    await mkdir(join(homeDir, ".kiro"), { recursive: true });
    expect(kiroIntegration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 kiro-cli 时即使无 ~/.kiro 也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kiro-bin-"));
    await writeFile(join(dir, "kiro-cli"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.detect()).toBe(true);
  });

  it("detect(): 不把旧的 kiro 命令误判为当前 Kiro CLI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kiro-legacy-bin-"));
    await writeFile(join(dir, "kiro"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { kiroIntegration } = await loadIntegration();
    expect(kiroIntegration.detect()).toBe(false);
  });
});

describe("withoutPierKiroHooks（纯清理）", () => {
  it("withoutPierKiroHooks 只移除 pier 条目，保留用户 hook", async () => {
    const { withoutPierKiroHooks } = await loadIntegration();
    const cleaned = withoutPierKiroHooks({
      name: "my-agent",
      hooks: {
        agentSpawn: [{ command: HISTORICAL_PIER_COMMAND }],
        stop: [{ command: "say done" }, { command: HISTORICAL_PIER_COMMAND }],
      },
    });
    const hooks = cleaned.hooks as Record<string, unknown[]>;
    expect(hooks.stop).toEqual([{ command: "say done" }]);
    expect(hooks.agentSpawn).toBeUndefined();
    expect(cleaned.name).toBe("my-agent");
  });

  it("withoutPierKiroHooks 无 pier 条目时原样返回输入引用", async () => {
    const { withoutPierKiroHooks } = await loadIntegration();
    const config = { hooks: { stop: [{ command: "say done" }] } };
    expect(withoutPierKiroHooks(config)).toBe(config);
  });
});

describe("install/uninstallKiroHooks（文件 IO，仅清理历史条目）", () => {
  it("install 对所有既存 agent 文件只移除历史 pier 条目", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(
      join(agentsDir(), "general-assistant.json"),
      JSON.stringify({
        name: "general-assistant",
        hooks: {
          stop: [{ command: "say done" }, { command: HISTORICAL_PIER_COMMAND }],
        },
      }),
      "utf8"
    );
    await writeFile(
      join(agentsDir(), "code-reviewer.json"),
      JSON.stringify({
        name: "code-reviewer",
        hooks: {
          preToolUse: [{ command: HISTORICAL_PIER_COMMAND, matcher: "*" }],
        },
      }),
      "utf8"
    );
    const { installKiroHooks } = await loadIntegration();
    await installKiroHooks();
    const generalAssistant = JSON.parse(
      await readFile(join(agentsDir(), "general-assistant.json"), "utf8")
    );
    expect(generalAssistant).toEqual({
      name: "general-assistant",
      hooks: { stop: [{ command: "say done" }] },
    });
    const codeReviewer = JSON.parse(
      await readFile(join(agentsDir(), "code-reviewer.json"), "utf8")
    );
    expect(codeReviewer).toEqual({ name: "code-reviewer", hooks: {} });
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
      JSON.stringify({
        name: "general-assistant",
        hooks: {
          stop: [{ command: "say done" }, { command: HISTORICAL_PIER_COMMAND }],
        },
      }),
      "utf8"
    );
    const { uninstallKiroHooks } = await loadIntegration();
    await uninstallKiroHooks();
    const parsed = JSON.parse(
      await readFile(join(agentsDir(), "general-assistant.json"), "utf8")
    );
    expect(parsed.name).toBe("general-assistant");
    expect(parsed.hooks).toEqual({ stop: [{ command: "say done" }] });
  });

  it("单个文件损坏不影响其他文件清理", async () => {
    await mkdir(agentsDir(), { recursive: true });
    await writeFile(join(agentsDir(), "broken.json"), "{ not json", "utf8");
    await writeFile(
      join(agentsDir(), "ok.json"),
      JSON.stringify({
        name: "ok",
        hooks: { stop: [{ command: HISTORICAL_PIER_COMMAND }] },
      }),
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
    expect(parsed).toEqual({ name: "ok", hooks: {} });
  });

  it("没有历史 pier 条目时 install 不改变文件字节", async () => {
    await mkdir(agentsDir(), { recursive: true });
    const original = JSON.stringify({ name: "a" });
    await writeFile(join(agentsDir(), "a.json"), original, "utf8");
    const { installKiroHooks } = await loadIntegration();
    await installKiroHooks();
    expect(await readFile(join(agentsDir(), "a.json"), "utf8")).toBe(original);
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
