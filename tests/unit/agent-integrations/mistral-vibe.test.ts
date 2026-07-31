import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const NATIVE_TYPES = ["pre_tool", "post_tool", "post_agent"];
const ORIGINAL_PATH = process.env.PATH;

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
    expect(block).toContain('\\"processing\\"');
    expect(block).toContain('\\"ToolComplete\\"');
    expect(block).toContain('\\"Stop\\"');
    expect(block).not.toContain('\\"ToolStart\\"');
    expect(block).not.toContain('\\"InteractionRequested\\"');
  });

  it("真实 post_tool 载荷保留父会话与工具身份，并把局部失败限制在工具层", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-vibe-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const { buildVibeHookBlock } = await loadModule();
    const postToolChunk = buildVibeHookBlock()
      .split("\n\n")
      .find((chunk) => chunk.includes('type = "post_tool"'));
    const commandLine = postToolChunk
      ?.split("\n")
      .find((line) => line.startsWith("command = "));
    const command = JSON.parse(
      (commandLine ?? "").slice("command = ".length)
    ) as string;
    const result = spawnSync("/bin/sh", ["-c", command], {
      env: {
        ...process.env,
        PATH: pathForHookSpawn(ORIGINAL_PATH),
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "panel-1",
        PIER_WINDOW_ID: "window-1",
      },
      input: JSON.stringify({
        hook_event_name: "post_tool",
        parent_session_id: "parent-1",
        session_id: "child-1",
        tool_call_id: "call-42",
        tool_name: "bash",
        tool_status: "failure",
        transcript_path: "/tmp/transcript.jsonl",
      }),
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    const row = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    expect(row).toMatchObject({
      agent: "mistral-vibe",
      event: "ToolComplete",
      nativeEvent: "post_tool",
      nativeState: "failure",
      parentSessionId: "parent-1",
      sessionId: "child-1",
      toolName: "bash",
      toolUseId: "call-42",
      transcriptPath: "/tmp/transcript.jsonl",
      v: 3,
    });
    if (row.kind !== "agentEvent") {
      throw new Error("expected agentEvent");
    }
    expect(row.event).not.toBe("error");

    await writeFile(logPath, "", "utf8");
    const block = buildVibeHookBlock();
    const commandFor = (type: string): string => {
      const chunk = block
        .split("\n\n")
        .find((entry) => entry.includes(`type = "${type}"`));
      const line = chunk
        ?.split("\n")
        .find((entry) => entry.startsWith("command = "));
      return JSON.parse((line ?? "").slice("command = ".length)) as string;
    };
    for (const [type, payload] of [
      [
        "pre_tool",
        {
          hook_event_name: "pre_tool",
          session_id: "main-1",
          tool_call_id: "call-main",
          tool_name: "bash",
        },
      ],
      [
        "post_tool",
        {
          hook_event_name: "post_tool",
          session_id: "main-1",
          tool_call_id: "call-main",
          tool_name: "bash",
          tool_status: "failure",
        },
      ],
      ["post_agent", { hook_event_name: "post_agent", session_id: "main-1" }],
    ] as const) {
      const invocation = spawnSync("/bin/sh", ["-c", commandFor(type)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(ORIGINAL_PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(invocation.status, invocation.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const event of rows) {
      if (event.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(event, { stopAuthority: "advisory" });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual(["processing", "processing"]);
    const finalActivity = aggregator.snapshot().activities[0];
    expect(finalActivity).toMatchObject({
      kind: "agent",
      sessionId: "main-1",
    });
    expect(finalActivity).not.toHaveProperty("status");
  }, 15_000);

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

  it("Pier 文本块内已有更高世代时保持原文，不降级覆盖", async () => {
    const { VIBE_BLOCK_MARKERS, withPierVibeHooks } = await loadModule();
    const newer = [
      VIBE_BLOCK_MARKERS.begin,
      "[[hooks]]",
      'type = "post_agent"',
      `command = "pier-hook-gen=11; \${PIER_AGENT_HOOKS_DIR}/emit"`,
      VIBE_BLOCK_MARKERS.end,
      "",
    ].join("\n");

    expect(withPierVibeHooks(newer)).toBe(newer);
  });

  it("多个旧 Pier 块在安装后收敛为一个当前块", async () => {
    const { VIBE_BLOCK_MARKERS, withPierVibeHooks } = await loadModule();
    const raw = [
      "first = true",
      VIBE_BLOCK_MARKERS.begin,
      "old = 1",
      VIBE_BLOCK_MARKERS.end,
      "middle = true",
      VIBE_BLOCK_MARKERS.begin,
      "old = 2",
      VIBE_BLOCK_MARKERS.end,
      "",
    ].join("\n");

    const installed = withPierVibeHooks(raw);
    expect(installed.split(VIBE_BLOCK_MARKERS.begin)).toHaveLength(2);
    expect(installed).not.toContain("old = 1");
    expect(installed).not.toContain("old = 2");
    expect(installed).toContain("middle = true");
  });

  it("TOML 字符串值内的完整 marker 文本不视为 Pier 块", async () => {
    const { VIBE_BLOCK_MARKERS, withPierVibeHooks } = await loadModule();
    const userLine = `note = ${JSON.stringify(VIBE_BLOCK_MARKERS.begin)}`;
    const installed = withPierVibeHooks(`${userLine}\n`);

    expect(installed).toContain(userLine);
    expect(installed.split(VIBE_BLOCK_MARKERS.begin)).toHaveLength(3);
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

  it("VIBE_HOME 覆盖默认目录并参与路径解析与探测", async () => {
    const customHome = await mkdtemp(join(tmpdir(), "pier-vibe-custom-"));
    vi.stubEnv("VIBE_HOME", customHome);
    const { vibeDetect, vibeHooksConfigPath } = await loadModule();
    expect(vibeHooksConfigPath()).toBe(join(customHome, "hooks.toml"));
    expect(vibeDetect()).toBe(true);
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

  it("VIBE_HOME 下安装和卸载只改 Pier 块，用户 TOML 注释原样保留", async () => {
    const customHome = await mkdtemp(join(tmpdir(), "pier-vibe-custom-io-"));
    const customPath = join(customHome, "hooks.toml");
    const original = `# user hook settings
[[hooks]]
name = "user-hook"
type = "pre_tool"
command = "echo user"
`;
    vi.stubEnv("VIBE_HOME", customHome);
    await writeFile(customPath, original, "utf8");
    const { mistralVibeIntegration } = await loadModule();
    await mistralVibeIntegration.install();
    expect(await readFile(customPath, "utf8")).toContain(
      "# user hook settings"
    );
    await mistralVibeIntegration.uninstall();
    expect(await readFile(customPath, "utf8")).toBe(original);
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
  it("id 为 mistral-vibe", async () => {
    const { mistralVibeIntegration } = await loadModule();
    expect(mistralVibeIntegration.id).toBe("mistral-vibe");
  });

  it("当前正式 hooks 无实验开关，也不产生旧版告警", async () => {
    await mkdir(join(homeDir, ".vibe"), { recursive: true });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // no-op
    });
    const { mistralVibeIntegration } = await loadModule();
    await mistralVibeIntegration.install();
    const installed = await readFile(hooksConfigPath(), "utf8");
    expect(installed).toContain("[[hooks]]");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
