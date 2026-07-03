import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_HOOKS_DIR";
const NATIVE_TYPES = ["before_tool", "after_tool", "post_agent_turn"];

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-vibe-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadModule() {
  return await import(
    "../../../src/main/services/agents/integrations/mistral-vibe.ts"
  );
}

function hooksConfigPath(): string {
  return join(homeDir, ".vibe", "hooks.toml");
}

function vibeConfigPath(): string {
  return join(homeDir, ".vibe", "config.toml");
}

describe("buildVibeHookBlock / withPierVibeHooks", () => {
  it("为每个 vibe hook type 生成一个 [[hooks]] 表条目", async () => {
    const { buildVibeHookBlock } = await loadModule();
    const block = buildVibeHookBlock();
    const matches = block.match(/\[\[hooks\]\]/g) ?? [];
    expect(matches).toHaveLength(NATIVE_TYPES.length);
    for (const t of NATIVE_TYPES) {
      expect(block).toContain(`type = "${t}"`);
    }
    expect(block).toContain("timeout = 10.0");
  });

  it("command 字面量含正确 agent id + pierEvent + emit 脚本引用", async () => {
    const { buildVibeHookBlock } = await loadModule();
    const block = buildVibeHookBlock();
    // TOML 双引号字面量里 shell 命令的 " 会被转义成 \" — 断言 emit 脚本引用 + agent + event
    expect(block).toContain(MARK);
    expect(block).toContain('\\"mistral-vibe\\"');
    expect(block).toContain('\\"ToolStart\\"');
    expect(block).toContain('\\"ToolComplete\\"');
    expect(block).toContain('\\"Stop\\"');
  });

  it("TOML 转义正确性：command 字面量是合法带引号转义的 TOML 字符串", async () => {
    const { buildVibeHookBlock } = await loadModule();
    const block = buildVibeHookBlock();
    const commandLine = block
      .split("\n")
      .find((l) => l.startsWith("command = "));
    expect(commandLine).toBeDefined();
    const literal = (commandLine as string).slice("command = ".length);
    const parsed = JSON.parse(literal); // TOML 双引号字面量 == JSON 字符串
    expect(parsed).toContain(MARK);
    expect(parsed).toContain("mistral-vibe");
  });

  it("幂等：重复安装字节不变", async () => {
    const { withPierVibeHooks } = await loadModule();
    const once = withPierVibeHooks("");
    const twice = withPierVibeHooks(once);
    expect(twice).toBe(once);
  });

  it("用户块外内容（用户自定义 [[hooks]] 条目）原样保留", async () => {
    const { withPierVibeHooks } = await loadModule();
    const user = '[[hooks]]\nname = "deny-rm-rf"\ntype = "before_tool"\n';
    const next = withPierVibeHooks(user);
    expect(next).toContain("deny-rm-rf");
  });
});

describe("withoutPierVibeHooks", () => {
  it("卸载后与原文件一致（还原）", async () => {
    const { withPierVibeHooks, withoutPierVibeHooks } = await loadModule();
    const original = '[[hooks]]\nname = "deny-rm-rf"\n';
    const installed = withPierVibeHooks(original);
    const removed = withoutPierVibeHooks(installed);
    expect(removed).toBe(original);
  });

  it("无 pier 块时原样返回", async () => {
    const { withoutPierVibeHooks } = await loadModule();
    const raw = 'name = "foo"\n';
    expect(withoutPierVibeHooks(raw)).toBe(raw);
  });
});

describe("vibeDetect", () => {
  it("~/.vibe 目录存在时为 true", async () => {
    const { vibeDetect } = await loadModule();
    expect(vibeDetect()).toBe(false);
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    expect(vibeDetect()).toBe(true);
  });

  it("commandExistsOnPath 兜底——PATH 上有 vibe 二进制时即使无目录也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-vibe-bin-"));
    await writeFile(join(dir, "vibe"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { vibeDetect } = await loadModule();
    expect(vibeDetect()).toBe(true);
  });
});

describe("vibeExperimentalHooksEnabled", () => {
  it("config.toml 不存在时为 false", async () => {
    const { vibeExperimentalHooksEnabled } = await loadModule();
    expect(await vibeExperimentalHooksEnabled()).toBe(false);
  });

  it("config.toml 含 enable_experimental_hooks = true 时为 true", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    await writeFile(
      vibeConfigPath(),
      "enable_experimental_hooks = true\n",
      "utf8"
    );
    const { vibeExperimentalHooksEnabled } = await loadModule();
    expect(await vibeExperimentalHooksEnabled()).toBe(true);
  });

  it("VIBE_ENABLE_EXPERIMENTAL_HOOKS=1 环境变量兜底为 true（无 config.toml）", async () => {
    vi.stubEnv("VIBE_ENABLE_EXPERIMENTAL_HOOKS", "1");
    const { vibeExperimentalHooksEnabled } = await loadModule();
    expect(await vibeExperimentalHooksEnabled()).toBe(true);
  });
});

describe("install/uninstallVibeHooks (文件 IO)", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-vibe-io-test-"));
    path = join(dir, "hooks.toml");
    await mkdir(dir, { recursive: true });
  });

  it("往不存在的 hooks.toml 安装并可卸载还原（detect 为真：目录已存在）", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    const { installVibeHooks, uninstallVibeHooks } = await loadModule();
    await writeFile(path, "", "utf8");
    await installVibeHooks(path);
    const installed = await readFile(path, "utf8");
    expect(installed).toContain("[[hooks]]");
    await uninstallVibeHooks(path);
    const cleaned = await readFile(path, "utf8");
    expect(cleaned).toBe("");
  });

  it("未安装时卸载零写入", async () => {
    const { uninstallVibeHooks } = await loadModule();
    await writeFile(path, 'name = "foo"\n', "utf8");
    const before = await readFile(path, "utf8");
    await uninstallVibeHooks(path);
    const after = await readFile(path, "utf8");
    expect(after).toBe(before);
  });

  it("重复安装第二次不改变文件内容", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    const { installVibeHooks } = await loadModule();
    await writeFile(path, "", "utf8");
    await installVibeHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installVibeHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });

  it("detect 为假时（无目录、无 vibe 命令）install 不写入任何文件", async () => {
    const { installVibeHooks, vibeDetect } = await loadModule();
    const missingPath = join(dir, "hooks.toml");
    expect(vibeDetect()).toBe(false);
    await installVibeHooks(missingPath);
    await expect(readFile(missingPath, "utf8")).rejects.toThrow();
  });
});

describe("mistralVibeIntegration 契约", () => {
  it("capability 为 coarse, id 为 mistral-vibe", async () => {
    const { mistralVibeIntegration } = await loadModule();
    expect(mistralVibeIntegration.capability).toBe("coarse");
    expect(mistralVibeIntegration.id).toBe("mistral-vibe");
  });

  it("install 在未开启实验开关时仍写入 hooks.toml（仅告警不阻塞）", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // no-op
    });
    const { mistralVibeIntegration } = await loadModule();
    await mistralVibeIntegration.install();
    const installed = await readFile(hooksConfigPath(), "utf8");
    expect(installed).toContain("[[hooks]]");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("install 在已开启实验开关时不告警", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    await writeFile(
      vibeConfigPath(),
      "enable_experimental_hooks = true\n",
      "utf8"
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // no-op
    });
    const { mistralVibeIntegration } = await loadModule();
    await mistralVibeIntegration.install();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
