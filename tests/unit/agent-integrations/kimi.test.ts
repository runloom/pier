import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  PIER_HOOK_COMMAND_GENERATION,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import {
  installKimiHooks,
  KIMI_HOOK_TIMEOUT_SECONDS_VALUE,
  kimiCodeHomeDir,
  kimiConfigPath,
  kimiDetect,
  kimiIntegration,
  kimiLegacyConfigPath,
  uninstallKimiHooks,
  withoutOrphanPierKimiHookEntries,
  withoutPierKimiHooks,
  withPierKimiHooks,
} from "../../../src/main/services/agents/integrations/kimi.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const HIGHER_HOOK_GENERATION = PIER_HOOK_COMMAND_GENERATION + 1;
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
  "PermissionRequest",
  "PermissionResult",
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

  it("command 字面量携带 agent id + pierEvent + PIER_AGENT_HOOKS_DIR mark", () => {
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
      expect(shellCommand).toContain('"kimi"');
    }
    // 至少一条 command 含 SessionStart / UserPromptSubmit。
    expect(next).toMatch(SESSION_START_HOOK_RE);
    expect(next).toMatch(USER_PROMPT_SUBMIT_HOOK_RE);
    expect(next).toContain('\\"agentEventV3\\"');
  });

  it("固定 Python 协议真实载荷保留 tool_call_id，StopFailure fatal，子智能体匿名计数", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-kimi-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const config = withPierKimiHooks("");
    const commandFor = (nativeEvent: string): string => {
      const chunk = config
        .split("[[hooks]]")
        .find((entry) => entry.includes(`event = "${nativeEvent}"`));
      const line = chunk
        ?.split("\n")
        .find((entry) => entry.startsWith("command = "));
      return JSON.parse((line ?? "").slice("command = ".length)) as string;
    };
    for (const [event, payload] of [
      [
        "SessionStart",
        { hook_event_name: "SessionStart", session_id: "session-k" },
      ],
      [
        "UserPromptSubmit",
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "Fix it",
          session_id: "session-k",
        },
      ],
      [
        "PreToolUse",
        {
          hook_event_name: "PreToolUse",
          session_id: "session-k",
          tool_call_id: "tool-k",
          tool_name: "Shell",
        },
      ],
      [
        "PostToolUseFailure",
        {
          hook_event_name: "PostToolUseFailure",
          error: "exit 1",
          session_id: "session-k",
          tool_call_id: "tool-k",
          tool_name: "Shell",
        },
      ],
      [
        "SubagentStart",
        {
          agent_name: "researcher",
          hook_event_name: "SubagentStart",
          session_id: "session-k",
        },
      ],
      [
        "SubagentStop",
        {
          agent_name: "researcher",
          hook_event_name: "SubagentStop",
          session_id: "session-k",
        },
      ],
      [
        "StopFailure",
        {
          error_message: "fatal model failure",
          error_type: "ModelError",
          hook_event_name: "StopFailure",
          session_id: "session-k",
        },
      ],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", commandFor(event)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(process.env.PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[2]).toMatchObject({
      event: "ToolStart",
      toolName: "Shell",
      toolUseId: "tool-k",
      v: 3,
    });
    expect(rows[3]).toMatchObject({
      event: "ToolComplete",
      toolUseId: "tool-k",
      v: 3,
    });
    expect(rows[4]).toMatchObject({
      agentType: "researcher",
      event: "SubagentStart",
    });
    expect(rows[4]).not.toHaveProperty("agentInstanceId");
    expect(rows.at(-1)).toMatchObject({
      event: "error",
      nativeEvent: "StopFailure",
      v: 3,
    });
    const aggregator = createForegroundActivityAggregator();
    const counts: number[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent") counts.push(activity.subagentCount);
    }
    // SessionStart 只更新身份缓存，首个 PromptSubmit 才创建前台活动。
    expect(counts).toEqual([0, 0, 0, 1, 0, 0]);
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "error",
    });
  }, 15_000);

  it("PermissionRequest/Result 用 toolCallId 配对，授权进 waiting", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-kimi-perm-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const config = withPierKimiHooks("");
    const commandFor = (nativeEvent: string): string => {
      const chunk = config
        .split("[[hooks]]")
        .find((entry) => entry.includes(`event = "${nativeEvent}"`));
      const line = chunk
        ?.split("\n")
        .find((entry) => entry.startsWith("command = "));
      return JSON.parse((line ?? "").slice("command = ".length)) as string;
    };
    for (const [event, payload] of [
      [
        "UserPromptSubmit",
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "Fix it",
          session_id: "session-k",
        },
      ],
      [
        "PreToolUse",
        {
          hook_event_name: "PreToolUse",
          session_id: "session-k",
          toolCallId: "tool-perm-k",
          toolName: "Bash",
        },
      ],
      [
        "PermissionRequest",
        {
          hook_event_name: "PermissionRequest",
          session_id: "session-k",
          toolCallId: "tool-perm-k",
          toolName: "Bash",
        },
      ],
      [
        "PermissionResult",
        {
          decision: "approved",
          hook_event_name: "PermissionResult",
          session_id: "session-k",
          toolCallId: "tool-perm-k",
        },
      ],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", commandFor(event)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(process.env.PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[2]).toMatchObject({
      event: "InteractionRequested",
      interactionId: "tool-perm-k",
      interactionKind: "permission",
      toolUseId: "tool-perm-k",
      v: 3,
    });
    expect(rows[3]).toMatchObject({
      event: "InteractionResolved",
      interactionId: "tool-perm-k",
      interactionKind: "permission",
      interactionOutcome: "accepted",
      nativeState: "approved",
      v: 3,
    });
    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual(["processing", "tool", "waiting", "tool"]);
  }, 15_000);

  it("空 turnId 的 StopFailure 后 PreToolUse 解封，不再钉死错误", () => {
    const aggregator = createForegroundActivityAggregator();
    const options = {
      evidenceSource: "hook",
      stopAuthority: "advisory",
      turnStartAuthority: "none",
    } as const;
    aggregator.ingestAgentEvent(
      {
        agent: "kimi",
        event: "SessionStart",
        kind: "agentEvent",
        nativeEvent: "SessionStart",
        panelId: "panel-1",
        v: 3,
        windowId: "window-1",
      },
      options
    );
    aggregator.ingestAgentEvent(
      {
        agent: "kimi",
        event: "error",
        kind: "agentEvent",
        nativeEvent: "StopFailure",
        panelId: "panel-1",
        v: 3,
        windowId: "window-1",
      },
      options
    );
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "error",
    });
    aggregator.ingestAgentEvent(
      {
        agent: "kimi",
        event: "ToolStart",
        kind: "agentEvent",
        nativeEvent: "PreToolUse",
        panelId: "panel-1",
        toolName: "Bash",
        toolUseId: "tool-k",
        v: 3,
        windowId: "window-1",
      },
      options
    );
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "tool",
    });
    aggregator.dispose();
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

  it("Pier 文本块内已有更高世代时保持原文，不降级覆盖", () => {
    const newer = [
      "# >>> pier-agent-status:kimi (managed by Pier; do not edit) >>>",
      "[[hooks]]",
      'event = "Stop"',
      `command = "pier-hook-gen=${HIGHER_HOOK_GENERATION}; \${PIER_AGENT_HOOKS_DIR}/emit"`,
      "# <<< pier-agent-status:kimi <<<",
      "",
    ].join("\n");

    expect(withPierKimiHooks(newer)).toBe(newer);
  });

  it("重复块以后块更高世代为准，旧客户端保持整份文件原样", () => {
    const begin =
      "# >>> pier-agent-status:kimi (managed by Pier; do not edit) >>>";
    const end = "# <<< pier-agent-status:kimi <<<";
    const raw = [
      "user = true",
      begin,
      'command = "pier-hook-gen=1; emit"',
      end,
      begin,
      `command = "pier-hook-gen=${HIGHER_HOOK_GENERATION}; emit"`,
      end,
      "",
    ].join("\n");

    expect(withPierKimiHooks(raw)).toBe(raw);
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

  it("剔除 marker 块外的孤儿 pier [[hooks]] 条目（上游重写 TOML 丢 marker 实证）", () => {
    // 本机 ~/.kimi/config.toml 实证形态：12 条孤儿（无 marker 包裹）+
    // 12 条块内。孤儿必须按 isPierHookCommand 所有权剔除，用户条目保留。
    const withBlock = withPierKimiHooks('user_setting = "keep"\n');
    const pierCommandLine = withBlock
      .split("\n")
      .find((line) => COMMAND_LINE_RE.test(line));
    expect(pierCommandLine).toBeDefined();
    const orphan = [
      "[[hooks]]",
      'event = "SessionStart"',
      pierCommandLine ?? "",
      "timeout = 5",
      "",
      "[[hooks]]",
      'event = "Stop"',
      'command = "say user-owned"',
      "timeout = 5",
      "",
    ].join("\n");
    const dirty = `user_setting = "keep"\n\n${orphan}${withBlock.slice('user_setting = "keep"\n'.length)}`;
    const cleaned = withoutPierKimiHooks(dirty);
    expect(cleaned).toContain('user_setting = "keep"');
    expect(cleaned).toContain('command = "say user-owned"');
    expect(cleaned).not.toContain(MARK);
    expect(cleaned).not.toContain("pier-agent-status:kimi");

    // 安装路径同样先清孤儿：不会出现双份 pier 条目。
    const reinstalled = withPierKimiHooks(
      withoutOrphanPierKimiHookEntries(dirty)
    );
    const pierEntryCount = reinstalled
      .split("\n")
      .filter(
        (line) => COMMAND_LINE_RE.test(line) && line.includes(MARK)
      ).length;
    expect(pierEntryCount).toBe(NATIVE_EVENTS.length);
  });

  it("更高世代孤儿不被旧客户端清掉", () => {
    const withBlock = withPierKimiHooks("");
    const commandLine = withBlock
      .split("\n")
      .find((line) => COMMAND_LINE_RE.test(line));
    expect(commandLine).toBeDefined();
    const higherLine = (commandLine ?? "").replace(
      `pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`,
      `pier-hook-gen=${HIGHER_HOOK_GENERATION}`
    );
    const newer = [
      "[[hooks]]",
      'event = "SessionStart"',
      higherLine,
      "timeout = 5",
      "",
    ].join("\n");
    expect(withoutOrphanPierKimiHookEntries(newer)).toContain(
      `pier-hook-gen=${HIGHER_HOOK_GENERATION}`
    );
    expect(withPierKimiHooks(newer)).toBe(newer);
  });

  it("含多行字符串的 TOML 保守不改（避免误切表头）", () => {
    const raw = [
      'note = """',
      "[[hooks]]",
      'command = "echo not-a-table"',
      '"""',
      "",
    ].join("\n");
    expect(withoutOrphanPierKimiHookEntries(raw)).toBe(raw);
  });

  it("带行尾注释的 Pier command 与旧 curl 孤儿仍能清掉", () => {
    const withBlock = withPierKimiHooks("");
    const commandLine = withBlock
      .split("\n")
      .find((line) => COMMAND_LINE_RE.test(line));
    expect(commandLine).toBeDefined();
    const emitOrphan = [
      "[[hooks]]",
      'event = "Stop"',
      `${commandLine} # trailing`,
      "",
    ].join("\n");
    const curlOrphan = [
      "[[hooks]]",
      'event = "Stop"',
      'command = "curl -s http://127.0.0.1:$PIER_AGENT_HOOK_PORT/hook"',
      "",
    ].join("\n");
    expect(withoutOrphanPierKimiHookEntries(emitOrphan)).not.toContain(MARK);
    expect(withoutOrphanPierKimiHookEntries(curlOrphan)).not.toContain(
      "PIER_AGENT_HOOK_PORT"
    );
  });

  it("卸载会清除同一文件中的全部完整 Pier 块", () => {
    const begin =
      "# >>> pier-agent-status:kimi (managed by Pier; do not edit) >>>";
    const end = "# <<< pier-agent-status:kimi <<<";
    const raw = [
      "first = true",
      begin,
      "old = 1",
      end,
      "middle = true",
      begin,
      "old = 2",
      end,
      "last = true",
      "",
    ].join("\n");

    const cleaned = withoutPierKimiHooks(raw);
    expect(cleaned).not.toContain(begin);
    expect(cleaned).toContain("first = true");
    expect(cleaned).toContain("middle = true");
    expect(cleaned).toContain("last = true");
  });
});

describe("kimiConfigPath / kimiLegacyConfigPath", () => {
  const originalHome = process.env.HOME;
  const originalShareDir = process.env.KIMI_SHARE_DIR;
  const originalCodeHome = process.env.KIMI_CODE_HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalShareDir === undefined) {
      delete process.env.KIMI_SHARE_DIR;
    } else {
      process.env.KIMI_SHARE_DIR = originalShareDir;
    }
    if (originalCodeHome === undefined) {
      delete process.env.KIMI_CODE_HOME;
    } else {
      process.env.KIMI_CODE_HOME = originalCodeHome;
    }
  });

  it("现行默认路径为 ~/.kimi-code/config.toml（Kimi Code 换代）", () => {
    process.env.HOME = "/tmp/pier-kimi-home";
    delete process.env.KIMI_CODE_HOME;
    expect(kimiConfigPath()).toBe("/tmp/pier-kimi-home/.kimi-code/config.toml");
  });

  it("$KIMI_CODE_HOME 覆盖现行目录", () => {
    process.env.KIMI_CODE_HOME = "/tmp/pier-kimi-code-home";
    expect(kimiCodeHomeDir()).toBe("/tmp/pier-kimi-code-home");
    expect(kimiConfigPath()).toBe("/tmp/pier-kimi-code-home/config.toml");
  });

  it("老 kimi-cli 路径为 ~/.kimi/config.toml（仅清理用）", () => {
    process.env.HOME = "/tmp/pier-kimi-home";
    delete process.env.KIMI_SHARE_DIR;
    expect(kimiLegacyConfigPath()).toBe(
      "/tmp/pier-kimi-home/.kimi/config.toml"
    );
  });

  it("$KIMI_SHARE_DIR 覆盖老目录", () => {
    process.env.KIMI_SHARE_DIR = "/tmp/pier-kimi-share";
    expect(kimiLegacyConfigPath()).toBe("/tmp/pier-kimi-share/config.toml");
  });
});

describe("install/uninstallKimiHooks (文件 IO)", () => {
  let dir: string;
  let configPath: string;
  const originalHome = process.env.HOME;
  const originalShareDir = process.env.KIMI_SHARE_DIR;
  const originalCodeHome = process.env.KIMI_CODE_HOME;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-kimi-io-"));
    // 隔离 HOME 防真机 ~/.config/agents/hooks 被遗留清理误碰。
    process.env.HOME = dir;
    delete process.env.KIMI_SHARE_DIR;
    delete process.env.KIMI_CODE_HOME;
    configPath = join(dir, "config.toml");
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalShareDir === undefined) {
      delete process.env.KIMI_SHARE_DIR;
    } else {
      process.env.KIMI_SHARE_DIR = originalShareDir;
    }
    if (originalCodeHome === undefined) {
      delete process.env.KIMI_CODE_HOME;
    } else {
      process.env.KIMI_CODE_HOME = originalCodeHome;
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

  it("安装写现行路径，同时清理老 ~/.kimi/config.toml 的 pier 条目（含孤儿）", async () => {
    const legacyPath = join(dir, "legacy-config.toml");
    const legacyWithBlock = withPierKimiHooks('legacy_user = "keep"\n');
    const pierCommandLine = legacyWithBlock
      .split("\n")
      .find((line) => COMMAND_LINE_RE.test(line));
    // 老文件形态：marker 块 + 一条孤儿 pier 条目（marker 被上游剥离的残留）。
    const legacyDirty = `${legacyWithBlock}\n[[hooks]]\nevent = "Stop"\n${pierCommandLine ?? ""}\ntimeout = 5\n`;
    await writeFile(legacyPath, legacyDirty, "utf8");

    await installKimiHooks(configPath, legacyPath);

    const legacyAfter = await readFile(legacyPath, "utf8");
    expect(legacyAfter).toContain('legacy_user = "keep"');
    expect(legacyAfter).not.toContain(MARK);
    expect(legacyAfter).not.toContain("pier-agent-status:kimi");
    const installed = await readFile(configPath, "utf8");
    expect(installed).toContain("pier-agent-status:kimi");

    await uninstallKimiHooks(configPath, legacyPath);
    expect(await readFile(configPath, "utf8")).not.toContain(MARK);
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
  it("id 为 kimi", () => {
    expect(kimiIntegration.id).toBe("kimi");
  });

  it("emittedMappings 含 PermissionRequest/Result 成对交互", () => {
    expect(kimiIntegration.runtime.emittedMappings).toEqual(
      expect.arrayContaining([
        {
          nativeEvent: "PermissionRequest",
          pierEvent: "InteractionRequested",
        },
        {
          nativeEvent: "PermissionResult",
          pierEvent: "InteractionResolved",
        },
      ])
    );
  });
});
