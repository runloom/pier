import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installKimiHooks,
  KIMI_HOOK_TIMEOUT_SECONDS_VALUE,
  kimiConfigPath,
  kimiDetect,
  kimiIntegration,
  uninstallKimiHooks,
  withoutPierKimiHooks,
  withPierKimiHooks,
} from "../../../src/main/services/agents/integrations/kimi.ts";

const MARK = "PIER_AGENT_HOOK_PORT";
const COMMAND_LINE_RE = /^command = (".*")$/;
const SESSION_START_HOOK_RE =
  /event = "SessionStart"[^[]*command = ".*SessionStart/;
const USER_PROMPT_SUBMIT_HOOK_RE =
  /event = "UserPromptSubmit"[^[]*command = ".*PromptSubmit/;
const NATIVE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
];

describe("withPierKimiHooks (TOML 注入)", () => {
  it("包裹 marker 块内含每个规范事件的 [[hooks]] 表", () => {
    const raw = "foo = 1\n";
    const next = withPierKimiHooks(raw);
    expect(next).toContain("pier-agent-status:kimi");
    for (const evt of NATIVE_EVENTS) {
      expect(next).toContain(`event = "${evt}"`);
    }
    // 事件数 = [[hooks]] 出现次数
    const count = (next.match(/\[\[hooks]]/g) ?? []).length;
    expect(count).toBe(NATIVE_EVENTS.length);
  });

  it("hook 字段：event/command/timeout（秒制, 1-600）", () => {
    const next = withPierKimiHooks("");
    expect(next).toContain(`timeout = ${KIMI_HOOK_TIMEOUT_SECONDS_VALUE}`);
    expect(KIMI_HOOK_TIMEOUT_SECONDS_VALUE).toBeGreaterThanOrEqual(1);
    expect(KIMI_HOOK_TIMEOUT_SECONDS_VALUE).toBeLessThanOrEqual(600);
    expect(next).toContain("command =");
  });

  it("command 字面量携带 agent id + pierEvent + PIER_AGENT_HOOK_PORT", () => {
    const next = withPierKimiHooks("");
    expect(next).toContain(MARK);
    // 解析 TOML 单行 command 字符串, 把 shell 命令还原成明文再断言事件负载。
    for (const line of next.split("\n")) {
      const commandMatch = line.match(COMMAND_LINE_RE);
      if (!commandMatch || commandMatch[1] === undefined) {
        continue;
      }
      const shellCommand = JSON.parse(commandMatch[1]) as string;
      expect(shellCommand).toContain(MARK);
      expect(shellCommand).toContain('\\"agent\\":\\"kimi\\"');
    }
    // 至少一条 command 含 SessionStart / UserPromptSubmit。
    expect(next).toMatch(SESSION_START_HOOK_RE);
    expect(next).toMatch(USER_PROMPT_SUBMIT_HOOK_RE);
  });

  it("幂等：二次注入同源同结果", () => {
    const once = withPierKimiHooks("foo = 1\n");
    const twice = withPierKimiHooks(once);
    expect(twice).toBe(once);
  });

  it("保留用户已有的其他 TOML 内容", () => {
    const raw = 'other = "keep"\n';
    const next = withPierKimiHooks(raw);
    expect(next).toContain('other = "keep"');
  });
});

describe("withoutPierKimiHooks (TOML 剔除)", () => {
  it("剔除后恢复原始内容", () => {
    const raw = 'foo = 1\nbar = "x"\n';
    const withBlock = withPierKimiHooks(raw);
    expect(withoutPierKimiHooks(withBlock)).toBe(raw);
  });

  it("无 pier marker 时原样返回输入引用", () => {
    const raw = "foo = 1\n";
    expect(withoutPierKimiHooks(raw)).toBe(raw);
  });
});

describe("kimiConfigPath", () => {
  const originalHome = process.env.HOME;
  const originalShareDir = process.env.KIMI_SHARE_DIR;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalShareDir === undefined) {
      delete process.env.KIMI_SHARE_DIR;
    } else {
      process.env.KIMI_SHARE_DIR = originalShareDir;
    }
  });

  it("默认路径为 ~/.kimi/config.toml", () => {
    process.env.HOME = "/tmp/pier-kimi-home";
    delete process.env.KIMI_SHARE_DIR;
    expect(kimiConfigPath()).toBe("/tmp/pier-kimi-home/.kimi/config.toml");
  });

  it("$KIMI_SHARE_DIR 覆盖默认目录", () => {
    process.env.KIMI_SHARE_DIR = "/tmp/pier-kimi-share";
    expect(kimiConfigPath()).toBe("/tmp/pier-kimi-share/config.toml");
  });
});

describe("install/uninstallKimiHooks (文件 IO)", () => {
  let dir: string;
  let configPath: string;
  const originalHome = process.env.HOME;
  const originalShareDir = process.env.KIMI_SHARE_DIR;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-kimi-io-"));
    // 隔离 HOME 防真机 ~/.config/agents/hooks 被遗留清理误碰。
    process.env.HOME = dir;
    delete process.env.KIMI_SHARE_DIR;
    configPath = join(dir, "config.toml");
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalShareDir === undefined) {
      delete process.env.KIMI_SHARE_DIR;
    } else {
      process.env.KIMI_SHARE_DIR = originalShareDir;
    }
  });

  it("安装：向空 config.toml 注入 marker 块", async () => {
    await writeFile(configPath, "", "utf8");
    await installKimiHooks(configPath);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("pier-agent-status:kimi");
    for (const evt of NATIVE_EVENTS) {
      expect(content).toContain(`event = "${evt}"`);
    }
  });

  it("安装：config.toml 不存在时创建并写入", async () => {
    await installKimiHooks(configPath);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("pier-agent-status:kimi");
  });

  it("卸载：从 config.toml 移除 marker 块, 保留用户其他内容", async () => {
    await writeFile(configPath, 'user_setting = "keep"\n', "utf8");
    await installKimiHooks(configPath);
    await uninstallKimiHooks(configPath);
    const content = await readFile(configPath, "utf8");
    expect(content).toBe('user_setting = "keep"\n');
  });

  it("幂等：重复安装内容不变", async () => {
    await writeFile(configPath, "", "utf8");
    await installKimiHooks(configPath);
    const first = await readFile(configPath, "utf8");
    await installKimiHooks(configPath);
    const second = await readFile(configPath, "utf8");
    expect(second).toBe(first);
  });

  it("卸载：config.toml 不存在时零副作用 no-op", async () => {
    await expect(uninstallKimiHooks(configPath)).resolves.toBeUndefined();
  });

  it("卸载：无 pier marker 的 config.toml 保持字节原样", async () => {
    const original = 'foo = "bar"\n';
    await writeFile(configPath, original, "utf8");
    await uninstallKimiHooks(configPath);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("清理 PR#1131 未合并方案遗留的 ~/.config/agents/hooks/pier-* 目录", async () => {
    const legacyDir = join(
      dir,
      ".config",
      "agents",
      "hooks",
      "pier-pre-session"
    );
    await mkdir(legacyDir, { recursive: true });
    const legacyContent =
      "---\n# pier-agent-status:v1 (managed by Pier; do not edit)\nname: pier-pre-session\n---\n";
    await writeFile(join(legacyDir, "HOOK.md"), legacyContent, "utf8");
    await installKimiHooks(configPath);
    await expect(
      readFile(join(legacyDir, "HOOK.md"), "utf8")
    ).rejects.toThrow();
  });

  it("非托管的 ~/.config/agents/hooks/pier-* 目录不删除", async () => {
    const foreignDir = join(dir, ".config", "agents", "hooks", "pier-foreign");
    await mkdir(foreignDir, { recursive: true });
    const foreign = "---\nname: someone-else\n---\n";
    await writeFile(join(foreignDir, "HOOK.md"), foreign, "utf8");
    await installKimiHooks(configPath);
    expect(await readFile(join(foreignDir, "HOOK.md"), "utf8")).toBe(foreign);
  });
});

describe("kimiDetect", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("config.toml 已存在时返回 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kimi-detect-"));
    process.env.HOME = dir;
    await mkdir(join(dir, ".kimi"), { recursive: true });
    await writeFile(join(dir, ".kimi", "config.toml"), "", "utf8");
    expect(kimiDetect()).toBe(true);
  });
});

describe("kimiIntegration 契约", () => {
  it("capability 为 full, id 为 kimi", () => {
    expect(kimiIntegration.capability).toBe("full");
    expect(kimiIntegration.id).toBe("kimi");
  });
});
