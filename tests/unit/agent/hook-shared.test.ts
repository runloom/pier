import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  PIER_HOOK_COMMAND_GENERATION,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import {
  createNestedJsonIntegration,
  isLegacyPierHttpHookCommand,
  isManagedPierHookCommand,
  isPierHookCommand,
  maxPierHookGenerationInSettings,
  type NestedHookEventSpec,
  type NestedJsonIntegrationSpec,
  pierBlockMarkers,
  pierClaudeUserPromptSubmitCommand,
  pierHookCommand,
  pierHookCommandV3,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinPermissionAcceptedThenToolStart,
  pierHookCommandWithStdinSessionId,
  pierHookCommandWithStdinStatusDispatch,
  pierTextBlockGeneration,
  removePierTextBlock,
  transformPierHooksUnlessNewer,
  upsertPierTextBlock,
  upsertPierTextBlockUnlessNewer,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "../../../src/main/services/agents/integrations/shared.ts";

describe("createNestedJsonIntegration 运行时事件声明", () => {
  it("真实双发命令与一对多运行时声明保持一致，普通事件不重复", {
    timeout: 15_000,
  }, async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "pier-nested-double-emit-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const spec = {
      agentId: "claude",
      configPath: () => "/dev/null",
      events: [
        {
          buildCommand: (agentId: AgentKind) =>
            pierHookCommandV3WithStdinPermissionAcceptedThenToolStart({
              agentId,
              interactionIdFields: ["tool_use_id"],
              nativeEvent: "PreToolUse",
            }),
          emittedPierEvents: ["InteractionResolved", "ToolStart"] as const,
          nativeEvent: "PreToolUse",
          pierEvent: "ToolStart",
        },
        { nativeEvent: "Stop", pierEvent: "Stop" },
      ],
      runtime: { stopAuthority: "advisory" },
    } satisfies NestedJsonIntegrationSpec;

    expect(createNestedJsonIntegration(spec).runtime.emittedMappings).toEqual([
      { nativeEvent: "PreToolUse", pierEvent: "InteractionResolved" },
      { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
      { nativeEvent: "Stop", pierEvent: "Stop" },
    ]);

    try {
      const buildCommand = spec.events[0]?.buildCommand;
      if (!buildCommand) {
        throw new Error("双发事件必须提供 buildCommand");
      }
      const result = spawnSync("/bin/sh", ["-c", buildCommand("claude")], {
        encoding: "utf8",
        env: {
          ...process.env,
          PIER_AGENT_EVENT_LOG: eventsJsonlPath(userData),
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify({
          session_id: "session-1",
          tool_use_id: "tool-1",
        }),
      });
      expect(result.status).toBe(0);
      const rows = (await readFile(eventsJsonlPath(userData), "utf8"))
        .trim()
        .split("\n")
        .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
      expect(rows).toMatchObject([
        {
          event: "InteractionResolved",
          interactionId: "tool-1",
          interactionKind: "permission",
          interactionOutcome: "accepted",
          nativeEvent: "PreToolUse",
          sessionId: "session-1",
        },
        {
          event: "ToolStart",
          nativeEvent: "PreToolUse",
          sessionId: "session-1",
          toolUseId: "tool-1",
        },
      ]);
    } finally {
      await rm(baseDir, { force: true, recursive: true });
    }
  });

  it("类型层拒绝没有真实双发构造器或不足两个输出的多事件声明", () => {
    // @ts-expect-error 多事件声明必须同时提供实际双发 buildCommand。
    const missingBuilder: NestedHookEventSpec = {
      emittedPierEvents: ["InteractionResolved", "ToolStart"],
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    };
    const singleOutput: NestedHookEventSpec = {
      buildCommand: () => "true",
      // @ts-expect-error emittedPierEvents 至少包含两个事件。
      emittedPierEvents: ["ToolStart"],
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    };

    expect(missingBuilder.emittedPierEvents).toHaveLength(2);
    expect(singleOutput.emittedPierEvents).toHaveLength(1);
  });
});

describe("pierHookCommand（JSONL emit 脚本格式）", () => {
  it("命令引用 emit 脚本路径并携带 agentEventV2 kind + agentId + pierEvent", () => {
    const cmd = pierHookCommand("codex", "PromptSubmit");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言 shell 命令里的 ${PIER_AGENT_HOOKS_DIR} 变量引用形式，本就该是字面量
    expect(cmd).toContain("${PIER_AGENT_HOOKS_DIR}/emit");
    // emit 脚本 kind dispatch：第一个位置参数固定为 agentEventV2
    expect(cmd).toContain('"agentEventV2"');
    expect(cmd).toContain('"codex"');
    expect(cmd).toContain('"PromptSubmit"');
    // 首参 agentEventV2 出现在 agentId 之前
    expect(cmd.indexOf('"agentEventV2"')).toBeLessThan(cmd.indexOf('"codex"'));
    expect(cmd.endsWith("|| true")).toBe(true);
  });

  it("isPierHookCommand 识别新格式", () => {
    const cmd = pierHookCommand("claude", "Stop");
    expect(isPierHookCommand(cmd)).toBe(true);
  });

  it("isPierHookCommand 拒绝老 HTTP curl 格式（LEGACY marker 已删）", () => {
    const oldCmd =
      '[ -n "$PIER_AGENT_HOOK_PORT" ] && curl -fsS http://127.0.0.1:$PIER_AGENT_HOOK_PORT/agent-event || true';
    expect(isPierHookCommand(oldCmd)).toBe(false);
  });

  it("isManagedPierHookCommand 覆盖 emit 与遗留 HTTP curl", () => {
    const oldCmd =
      '[ -n "$PIER_AGENT_HOOK_PORT" ] && curl -fsS http://127.0.0.1:$PIER_AGENT_HOOK_PORT/agent-event || true';
    const emitCmd = pierHookCommand("claude", "Stop");
    expect(isLegacyPierHttpHookCommand(oldCmd)).toBe(true);
    expect(isManagedPierHookCommand(oldCmd)).toBe(true);
    expect(isManagedPierHookCommand(emitCmd)).toBe(true);
    expect(isManagedPierHookCommand("echo hello")).toBe(false);
  });

  it("withoutPierNestedHooks 清掉遗留 PIER_AGENT_HOOK_PORT curl", () => {
    const dirty = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                command:
                  '[ -n "$PIER_AGENT_HOOK_PORT" ] && curl -fsS -m 2 -X POST "http://127.0.0.1:$PIER_AGENT_HOOK_PORT/agent-event" || true',
                timeout: 5,
                type: "command",
              },
            ],
          },
          {
            hooks: [
              {
                command: "echo user-owned",
                timeout: 5,
                type: "command",
              },
            ],
          },
        ],
      },
    };
    const cleaned = withoutPierNestedHooks(dirty);
    const groups = (cleaned.hooks as { PreToolUse: unknown[] }).PreToolUse;
    expect(groups).toHaveLength(1);
    expect(JSON.stringify(groups)).toContain("user-owned");
    expect(JSON.stringify(groups)).not.toContain("PIER_AGENT_HOOK_PORT");
  });

  it("isPierHookCommand 排除无关命令", () => {
    expect(isPierHookCommand("echo hello")).toBe(false);
    expect(isPierHookCommand(42)).toBe(false);
    expect(isPierHookCommand(null)).toBe(false);
  });

  it.each([
    `echo "\${PIER_AGENT_HOOKS_DIR}"`,
    `echo "\${PIER_AGENT_HOOKS_DIR}/emit"`,
    `"\${PIER_AGENT_HOOKS_DIR}/user-script" "arg"`,
  ])("仅引用 hooks 目录或调用非 emit 脚本不视为 Pier 命令：%s", (command) => {
    expect(isPierHookCommand(command)).toBe(false);
  });

  it("兼容确证的旧 Pier emit 调用", () => {
    const historical = `pier-hook-gen=1; "\${PIER_AGENT_HOOKS_DIR}/emit" legacy`;
    expect(isPierHookCommand(historical)).toBe(true);
  });
});

describe("pierHookCommandWithStdinStatusDispatch（payload status → pier 事件）", () => {
  const cmd = pierHookCommandWithStdinStatusDispatch("cursor", "Stop", "stop", [
    { nativeStatus: "completed", pierEvent: "TurnCompleted" },
    { nativeStatus: "aborted", pierEvent: "TurnInterrupted" },
  ]);

  it("命令内含 case 分发与 fallback 分支, emit 使用运行期变量", () => {
    expect(cmd).toContain('"status"');
    expect(cmd).toContain('completed) _pier_event="TurnCompleted" ;;');
    expect(cmd).toContain('aborted) _pier_event="TurnInterrupted" ;;');
    expect(cmd).toContain('*) _pier_event="Stop" ;;');
    // emit 的 pierEvent 位置是 shell 变量引用, nativeEvent 保持原生名
    expect(cmd).toContain('"$_pier_event" "stop"');
    expect(isPierHookCommand(cmd)).toBe(true);
  });

  it("保留 stdin 身份提取（session/turn/transcript 等 v2 载荷）", () => {
    expect(cmd).toContain('"$_pier_session_id"');
    expect(cmd).toContain('"$_pier_transcript_path"');
    expect(cmd).toContain('"$_pier_metadata_b64"');
    expect(cmd.endsWith("|| true")).toBe(true);
  });

  it("status 分发只读取顶层字符串，嵌套状态不覆盖回退或顶层状态", async () => {
    const baseDir = await mkdtemp(
      join(tmpdir(), "pier-hook-status-top-level-")
    );
    try {
      const userData = join(baseDir, "userData");
      const hooksHome = join(baseDir, "hooks");
      await installAgentHooksEmitScript(userData, { hooksHome });
      const logPath = eventsJsonlPath(userData);
      const env = {
        ...process.env,
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "panel-1",
        PIER_WINDOW_ID: "window-1",
      };
      const run = (payload: Record<string, unknown>) =>
        spawnSync("/bin/sh", ["-c", cmd], {
          encoding: "utf8",
          env,
          input: JSON.stringify(payload),
        });

      expect(run({ nested: { status: "completed" } }).status).toBe(0);
      expect(
        run({
          status: "completed",
          nested: { status: "aborted" },
        }).status
      ).toBe(0);

      const rows = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => agentHookEventSchema.parse(JSON.parse(line)))
        .filter(
          (event): event is AgentHookEventPayload => event.kind === "agentEvent"
        );
      expect(rows.map((event) => event.event)).toEqual([
        "Stop",
        "TurnCompleted",
      ]);
    } finally {
      await rm(baseDir, { force: true, recursive: true });
    }
  }, 15_000);
});

describe("withPierNestedHooks（matcher 约定）", () => {
  const spec = {
    agentId: "grok" as const,
    configPath: () => "/dev/null",
    runtime: { stopAuthority: "advisory" as const },
    events: [
      { nativeEvent: "PreToolUse", pierEvent: "ToolStart", matcher: "*" },
      { nativeEvent: "Stop", pierEvent: "Stop" },
    ],
  };

  it("有 matcher 的事件写 matcher 字段, 无则省略", () => {
    const out = withPierNestedHooks({}, spec);
    const hooks = out.hooks as Record<string, Record<string, unknown>[]>;
    expect(hooks.PreToolUse?.[0]?.matcher).toBe("*");
    expect("matcher" in (hooks.Stop?.[0] ?? {})).toBe(false);
  });

  it("stdin 身份提取同时覆盖 snake_case 与 camelCase（Grok envelope）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "pier-hook-grok-aliases-"));
    const cmd = pierHookCommandWithStdinStatusDispatch("grok", "Stop", "Stop", [
      { nativeStatus: "completed", pierEvent: "TurnCompleted" },
    ]);
    try {
      const userData = join(baseDir, "userData");
      const hooksHome = join(baseDir, "hooks");
      await installAgentHooksEmitScript(userData, { hooksHome });
      const logPath = eventsJsonlPath(userData);
      const env = {
        ...process.env,
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "panel-1",
        PIER_WINDOW_ID: "window-1",
      };
      const run = (payload: Record<string, unknown>) =>
        spawnSync("/bin/sh", ["-c", cmd], {
          encoding: "utf8",
          env,
          input: JSON.stringify(payload),
        });

      expect(
        run({
          agent_id: "worker-snake",
          agent_type: "researcher-snake",
          session_id: "session-snake",
          status: "completed",
          tool_name: "Shell",
          tool_use_id: "tool-snake",
          transcript_path: "/tmp/snake.jsonl",
          turn_id: "turn-snake",
        }).status
      ).toBe(0);
      expect(
        run({
          agentId: "worker-camel",
          agentType: "researcher-camel",
          sessionId: "session-camel",
          status: "completed",
          toolName: "Shell",
          toolUseId: "tool-camel",
          transcriptPath: "/tmp/camel.jsonl",
          turnId: "turn-camel",
        }).status
      ).toBe(0);

      const rows = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
      expect(rows[0]).toMatchObject({
        agentInstanceId: "worker-snake",
        agentType: "researcher-snake",
        event: "TurnCompleted",
        sessionId: "session-snake",
        toolName: "Shell",
        toolUseId: "tool-snake",
        transcriptPath: "/tmp/snake.jsonl",
        turnId: "turn-snake",
        v: 2,
      });
      expect(rows[1]).toMatchObject({
        agentInstanceId: "worker-camel",
        agentType: "researcher-camel",
        event: "TurnCompleted",
        sessionId: "session-camel",
        toolName: "Shell",
        toolUseId: "tool-camel",
        transcriptPath: "/tmp/camel.jsonl",
        turnId: "turn-camel",
        v: 2,
      });
      expect(cmd).toContain(`pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`);
    } finally {
      await rm(baseDir, { force: true, recursive: true });
    }
  }, 15_000);

  it("stdin hook 命令不嵌 Electron 绝对路径（跨 worktree 信任稳定）", () => {
    const cmds = [
      pierHookCommandWithStdinSessionId("codex", "Stop", "Stop"),
      pierHookCommandWithStdinStatusDispatch("codex", "Stop", "Stop", [
        { nativeStatus: "completed", pierEvent: "TurnCompleted" },
      ]),
      pierClaudeUserPromptSubmitCommand("claude"),
    ];
    // 拼接避免 biome noTemplateCurlyInString / noUnusedTemplateLiteral 互搏。
    const hooksDirRef = ["$", "{PIER_AGENT_HOOKS_DIR}"].join("");
    for (const cmd of cmds) {
      expect(cmd).toContain(`${hooksDirRef}/extract-stdin-meta`);
      expect(cmd).not.toContain("ELECTRON_RUN_AS_NODE");
      expect(cmd).not.toContain(process.execPath);
      expect(cmd).not.toMatch(/\/Users\/|\/home\/|\/Applications\//);
    }
    // gen≥11：Claude UserPromptSubmit 不再双写 sessionTitle。
    expect(cmds[2]).not.toContain("derive-claude-session-title");
  });

  it("幂等 + 保留用户条目 + 卸载还原", () => {
    const user = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say hi" }] }] },
    };
    const once = withPierNestedHooks(user, spec);
    const twice = withPierNestedHooks(once, spec);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const cleaned = withoutPierNestedHooks(twice);
    expect((cleaned.hooks as Record<string, unknown[]>).Stop).toHaveLength(1);
    expect(
      (cleaned.hooks as Record<string, unknown>).PreToolUse
    ).toBeUndefined();
  });

  it("安装与卸载均保留仅引用 hooks 环境变量的用户命令", () => {
    const userCommands = [
      `echo "\${PIER_AGENT_HOOKS_DIR}"`,
      `echo "\${PIER_AGENT_HOOKS_DIR}/emit"`,
      `"\${PIER_AGENT_HOOKS_DIR}/user-script" "arg"`,
    ];
    const user = {
      hooks: {
        Stop: [
          {
            hooks: userCommands.map((command) => ({
              command,
              type: "command",
            })),
          },
        ],
      },
    };

    const installed = withPierNestedHooks(user, spec);
    const cleaned = withoutPierNestedHooks(installed);
    expect(
      (
        (
          cleaned.hooks as Record<
            string,
            Array<{ hooks: Array<{ command: string }> }>
          >
        ).Stop?.[0]?.hooks ?? []
      ).map((hook) => hook.command)
    ).toEqual(userCommands);
  });

  it("同一 matcher 内只删除 Pier handler，保留用户 handler 与 matcher", () => {
    const installed = withPierNestedHooks({}, spec);
    const hooks = installed.hooks as Record<
      string,
      Array<{
        hooks: Array<{ command: string; type: "command" }>;
        matcher?: string;
      }>
    >;
    hooks.PreToolUse?.[0]?.hooks.push({
      command: "user-pre-tool",
      type: "command",
    });

    const cleaned = withoutPierNestedHooks(installed);

    expect((cleaned.hooks as typeof hooks).PreToolUse).toEqual([
      {
        hooks: [{ command: "user-pre-tool", type: "command" }],
        matcher: "*",
      },
    ]);
  });

  it.each([
    ['{"hooks":"user-value"}', "hooks 非对象"],
    ['{"hooks":{"Stop":{"custom":true}}}', "目标事件非数组"],
  ])("共享 IO 对合法 JSON 的异常 shape 原字节跳过：%s", async (raw) => {
    const dir = await mkdtemp(join(tmpdir(), "pier-nested-shape-"));
    const path = join(dir, "settings.json");
    await writeFile(path, raw, "utf8");
    const integration = createNestedJsonIntegration({
      ...spec,
      configPath: () => path,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await integration.install();
      expect(await readFile(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("目标键异常时不会先清理另一键的旧 Pier 条目", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-nested-shape-cleanup-"));
    const path = join(dir, "settings.json");
    const raw = JSON.stringify({
      hooks: {
        LegacyEvent: [
          {
            hooks: [
              {
                command: `pier-hook-gen=9; "\${PIER_AGENT_HOOKS_DIR}/emit" legacy`,
              },
            ],
          },
        ],
        Stop: { custom: true },
      },
    });
    await writeFile(path, raw, "utf8");
    const integration = createNestedJsonIntegration({
      ...spec,
      configPath: () => path,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await integration.install();
      expect(await readFile(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("文本块注入（TOML/YAML marker 模式）", () => {
  it("upsert 幂等替换, remove 还原, 无块原引用返回", () => {
    const raw = "theme = dark\n";
    const v1 = upsertPierTextBlock(raw, "kimi", '[[hooks]]\nevent = "Stop"');
    expect(v1).toContain("pier-agent-status:kimi");
    const v2 = upsertPierTextBlock(v1, "kimi", '[[hooks]]\nevent = "Stop"');
    expect(v2).toBe(v1.endsWith("\n") ? v2 : v2); // 幂等（内容一致）
    expect(upsertPierTextBlock(v1, "kimi", '[[hooks]]\nevent = "Stop"')).toBe(
      v1
    );
    const removed = removePierTextBlock(v1, "kimi");
    expect(removed).toBe(raw);
    expect(removePierTextBlock(raw, "kimi")).toBe(raw);
  });

  it("多块世代取最大值，后块更高世代时旧客户端零写入", () => {
    const { begin, end } = pierBlockMarkers("kimi");
    const raw = [
      "theme = dark",
      begin,
      'command = "pier-hook-gen=1; emit"',
      end,
      "user = true",
      begin,
      `command = "pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION + 1}; emit"`,
      end,
      "",
    ].join("\n");

    expect(pierTextBlockGeneration(raw, "kimi")).toBe(
      PIER_HOOK_COMMAND_GENERATION + 1
    );
    expect(upsertPierTextBlockUnlessNewer(raw, "kimi", "replacement")).toBe(
      raw
    );
  });

  it("卸载清除全部完整块，安装把多个旧块收敛为单块", () => {
    const { begin, end } = pierBlockMarkers("kimi");
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

    const removed = removePierTextBlock(raw, "kimi");
    expect(removed).not.toContain(begin);
    expect(removed).toContain("first = true");
    expect(removed).toContain("middle = true");
    expect(removed).toContain("last = true");

    const installed = upsertPierTextBlock(raw, "kimi", "current = true");
    expect(installed.split(begin)).toHaveLength(2);
    expect(installed).not.toContain("old = 1");
    expect(installed).not.toContain("old = 2");
  });

  it("只识别独占整行 marker，字符串值内的完整 marker 文本仍属用户内容", () => {
    const { begin, end } = pierBlockMarkers("kimi");
    const raw = [
      `begin_text = ${JSON.stringify(begin)}`,
      `end_text = ${JSON.stringify(end)}`,
      "",
    ].join("\n");

    expect(pierTextBlockGeneration(raw, "kimi")).toBe(0);
    expect(removePierTextBlock(raw, "kimi")).toBe(raw);
    const installed = upsertPierTextBlock(raw, "kimi", "current = true");
    expect(installed).toContain(`begin_text = ${JSON.stringify(begin)}`);
    expect(installed.split(`\n${begin}\n`)).toHaveLength(2);
  });

  it("兼容 CRLF 独占整行 marker", () => {
    const { begin, end } = pierBlockMarkers("kimi");
    const raw = `user = true\r\n${begin}\r\npier-hook-gen=3\r\n${end}\r\n`;

    expect(pierTextBlockGeneration(raw, "kimi")).toBe(3);
    expect(removePierTextBlock(raw, "kimi")).toBe("user = true\r\n");
  });

  it.each([
    ["嵌套 begin", "before\n{begin}\nowned\n{begin}\nnested\n{end}\nafter\n"],
    ["孤立 begin", "before\n{begin}\nowned\nafter\n"],
    ["孤立 end", "before\n{end}\nafter\n"],
  ])("%s 时安装和卸载均保守原样跳过并警告", (_label, template) => {
    const { begin, end } = pierBlockMarkers("kimi");
    const raw = template.replaceAll("{begin}", begin).replaceAll("{end}", end);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(removePierTextBlock(raw, "kimi")).toBe(raw);
      expect(upsertPierTextBlock(raw, "kimi", "replacement")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("transformPierHooksUnlessNewer（世代门控）", () => {
  function nestedPierSettings(gen: number): Record<string, unknown> {
    return {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `_pier_hook_gen=pier-hook-gen=${gen}; [ -x "\${PIER_AGENT_HOOKS_DIR}/emit" ] && "\${PIER_AGENT_HOOKS_DIR}/emit" || true`,
              },
            ],
          },
        ],
      },
    };
  }

  it("磁盘世代更高时保留原引用（防旧 worktree 降级）", () => {
    const settings = nestedPierSettings(PIER_HOOK_COMMAND_GENERATION + 1);
    let rewriteCalls = 0;
    const out = transformPierHooksUnlessNewer(settings, (s) => {
      rewriteCalls += 1;
      return { ...s, rewritten: true };
    });
    expect(rewriteCalls).toBe(0);
    expect(out).toBe(settings);
    expect(maxPierHookGenerationInSettings(settings)).toBe(
      PIER_HOOK_COMMAND_GENERATION + 1
    );
  });

  it("磁盘世代 ≤ 当前时执行 rewrite，且新命令无 execPath", () => {
    const settings = nestedPierSettings(PIER_HOOK_COMMAND_GENERATION - 1);
    const out = transformPierHooksUnlessNewer(settings, () =>
      withPierNestedHooks(
        {},
        {
          agentId: "codex",
          configPath: () => "/dev/null",
          runtime: { stopAuthority: "advisory" },
          events: [{ nativeEvent: "Stop", pierEvent: "Stop" }],
        }
      )
    );
    expect(out).not.toBe(settings);
    const cmd = (
      out.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
    ).Stop?.[0]?.hooks?.[0]?.command;
    expect(cmd).toContain(`pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`);
    expect(cmd).not.toContain("ELECTRON_RUN_AS_NODE");
    expect(cmd).not.toContain(process.execPath);
    expect(maxPierHookGenerationInSettings(out)).toBe(
      PIER_HOOK_COMMAND_GENERATION
    );
  });
});

describe("stdin hook 缺脚本时不阻断 agent", () => {
  it("PIER_AGENT_HOOKS_DIR 指向空目录时 hook 命令 exit 0", {
    timeout: 15_000,
  }, () => {
    const cmd = pierHookCommandWithStdinSessionId("codex", "Stop", "Stop");
    const r = spawnSync("/bin/sh", ["-c", cmd], {
      input: JSON.stringify({ prompt: "hello", session_id: "s1" }),
      encoding: "utf8",
      env: {
        ...process.env,
        PIER_AGENT_HOOKS_DIR:
          "/tmp/pier-hooks-missing-dir-that-should-not-exist",
      },
    });
    expect(r.status).toBe(0);
  });
});

describe("pierHookCommandV3（严格 v3 对象式构造器）", () => {
  let baseDir: string | null = null;

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { force: true, recursive: true });
      baseDir = null;
    }
  });

  it("显式字段经过真实 shell 与 emit 后生成标准、请求和解除事件", {
    timeout: 15_000,
  }, async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-hook-v3-command-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      HOOK_INTERACTION_ID: "permission-1",
      HOOK_NATIVE_STATE: "busy",
      HOOK_PARENT_SESSION: "parent-1",
      HOOK_SESSION: "session-1",
      HOOK_TOOL_ID: "tool-1",
      HOOK_TURN: "turn-1",
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "panel-1",
      PIER_WINDOW_ID: "window-1",
    };
    const commands = [
      pierHookCommandV3({
        actorHint: "subagent",
        agentId: "claude",
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        nativeState: "$HOOK_NATIVE_STATE",
        parentSessionId: "$HOOK_PARENT_SESSION",
        sessionId: "$HOOK_SESSION",
        toolName: "Shell",
        toolUseId: "$HOOK_TOOL_ID",
        turnId: "$HOOK_TURN",
      }),
      pierHookCommandV3({
        actorHint: "main",
        agentId: "claude",
        event: "InteractionRequested",
        interactionId: "$HOOK_INTERACTION_ID",
        interactionKind: "permission",
        nativeEvent: "PermissionRequest",
        sessionId: "$HOOK_SESSION",
      }),
      pierHookCommandV3({
        actorHint: "main",
        agentId: "claude",
        event: "InteractionResolved",
        interactionId: "$HOOK_INTERACTION_ID",
        interactionKind: "permission",
        interactionOutcome: "accepted",
        nativeEvent: "PermissionResult",
        sessionId: "$HOOK_SESSION",
      }),
    ];
    for (const command of commands) {
      expect(spawnSync("/bin/sh", ["-c", command], { env }).status).toBe(0);
    }

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      actorHint: "subagent",
      event: "ToolStart",
      nativeState: "busy",
      parentSessionId: "parent-1",
      sessionId: "session-1",
      toolName: "Shell",
      toolUseId: "tool-1",
      turnId: "turn-1",
      v: 3,
    });
    expect(rows[1]).toMatchObject({
      event: "InteractionRequested",
      interactionId: "permission-1",
      interactionKind: "permission",
      v: 3,
    });
    expect(rows[2]).toMatchObject({
      event: "InteractionResolved",
      interactionId: "permission-1",
      interactionKind: "permission",
      interactionOutcome: "accepted",
      v: 3,
    });
  });

  it("运行时绕过类型时，构造器仍按事件分支剥离不允许的交互字段", {
    timeout: 15_000,
  }, async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-hook-v3-capture-"));
    const hooksDir = join(baseDir, "hooks");
    const capturePath = join(baseDir, "captured-args.txt");
    const emitPath = join(hooksDir, "emit");
    await mkdir(hooksDir);
    await writeFile(
      emitPath,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$PIER_CAPTURE_PATH"\n'
    );
    await chmod(emitPath, 0o755);
    const env = {
      ...process.env,
      PIER_AGENT_HOOKS_DIR: hooksDir,
      PIER_CAPTURE_PATH: capturePath,
    };
    const runAndReadArgs = async (
      spec: Parameters<typeof pierHookCommandV3>[0]
    ) => {
      const result = spawnSync("/bin/sh", ["-c", pierHookCommandV3(spec)], {
        env,
      });
      expect(result.status).toBe(0);
      return (await readFile(capturePath, "utf8")).split("\n");
    };

    const standardArgs = await runAndReadArgs({
      agentId: "claude",
      event: "ToolStart",
      interactionId: "must-be-removed",
      interactionKind: "permission",
      interactionOutcome: "accepted",
      nativeEvent: "PreToolUse",
    } as Parameters<typeof pierHookCommandV3>[0]);
    expect(standardArgs.slice(15, 18)).toEqual(["", "", ""]);

    const requestedArgs = await runAndReadArgs({
      agentId: "claude",
      event: "InteractionRequested",
      interactionId: "permission-1",
      interactionKind: "permission",
      interactionOutcome: "accepted-must-be-removed",
      nativeEvent: "PermissionRequest",
    } as Parameters<typeof pierHookCommandV3>[0]);
    expect(requestedArgs.slice(15, 18)).toEqual([
      "permission-1",
      "permission",
      "",
    ]);
  });

  it("stdin 已审计别名进入 v3，interactionId 仅从调用方指定字段提取", {
    timeout: 15_000,
  }, async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-hook-v3-stdin-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "panel-1",
      PIER_WINDOW_ID: "window-1",
    };
    const run = (command: string, payload: Record<string, unknown>) =>
      spawnSync("/bin/sh", ["-c", command], {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      });

    expect(
      run(
        pierHookCommandV3WithStdin({
          actorHint: "subagent",
          agentId: "claude",
          event: "InteractionRequested",
          interactionIdFields: ["permission_id", "permissionId"],
          interactionKind: "permission",
          nativeEvent: "PermissionRequest",
          nativeStateFields: ["status"],
        }),
        {
          conversation_id: "conversation-1",
          id: "generic-id-must-not-win",
          parent_session_id: "parent-1",
          permission_id: "permission-1",
          status: "waiting",
          tool_call_id: "tool-call-1",
          turnId: "turn-1",
        }
      ).status
    ).toBe(0);
    expect(
      run(
        pierHookCommandV3WithStdin({
          agentId: "claude",
          event: "PromptSubmit",
          nativeEvent: "UserPromptSubmit",
        }),
        {
          id: "generic-id-must-stay-unmapped",
          parentSessionId: "parent-2",
          taskId: "task-2",
          toolCallId: "tool-call-2",
        }
      ).status
    ).toBe(0);
    expect(
      run(
        pierHookCommandV3WithStdin({
          agentId: "claude",
          event: "InteractionRequested",
          interactionKind: "permission",
          nativeEvent: "PermissionRequest",
        }),
        { id: "generic-id-must-stay-unmapped" }
      ).status
    ).toBe(0);

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[0]).toMatchObject({
      actorHint: "subagent",
      interactionId: "permission-1",
      nativeState: "waiting",
      parentSessionId: "parent-1",
      sessionId: "conversation-1",
      toolUseId: "tool-call-1",
      turnId: "turn-1",
      v: 3,
    });
    expect(rows[1]).toMatchObject({
      parentSessionId: "parent-2",
      sessionId: "task-2",
      toolUseId: "tool-call-2",
      v: 3,
    });
    expect(rows[2]).not.toHaveProperty("interactionId");
  });

  it("超过 65536 字节的合法 stdin 仍完整提取会话与工具身份", {
    timeout: 15_000,
  }, async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-hook-v3-large-stdin-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const payload = {
      tool_call: {
        input: { content: "x".repeat(70_000) },
        id: "large-tool-1",
        name: "write_file",
      },
      taskId: "large-task-1",
    };
    expect(JSON.stringify(payload).length).toBeGreaterThan(65_536);

    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        pierHookCommandV3WithStdin({
          agentId: "cline",
          event: "ToolStart",
          nativeEvent: "PreToolUse",
          toolNamePaths: ["tool_call.name"],
          toolUseIdPaths: ["tool_call.id"],
        }),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      }
    );

    expect(result.status, result.stderr).toBe(0);
    const row = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    expect(row).toMatchObject({
      event: "ToolStart",
      nativeEvent: "PreToolUse",
      sessionId: "large-task-1",
      toolName: "write_file",
      toolUseId: "large-tool-1",
      v: 3,
    });
  });

  it("stdin 只读取顶层字符串，嵌套字段不冒充会话、任务或交互编号", {
    timeout: 15_000,
  }, async () => {
    baseDir = await mkdtemp(join(tmpdir(), "pier-hook-v3-top-level-"));
    const userData = join(baseDir, "userData");
    const hooksHome = join(baseDir, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "panel-1",
      PIER_WINDOW_ID: "window-1",
    };
    const command = pierHookCommandV3WithStdin({
      agentId: "claude",
      event: "InteractionRequested",
      interactionIdFields: [
        "permission_id",
        "permissionId",
        "invalid-field-name",
      ],
      interactionKind: "permission",
      nativeEvent: "PermissionRequest",
      nativeStateFields: ["status"],
    });
    const run = (payload: Record<string, unknown>) =>
      spawnSync("/bin/sh", ["-c", command], {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      });

    expect(
      run({
        nested: {
          conversation_id: "nested-conversation",
          permission_id: "nested-permission",
          status: "nested-status",
          task_id: "nested-task",
        },
      }).status
    ).toBe(0);
    expect(
      run({
        conversation_id: "top-conversation",
        permission_id: "top-permission",
        status: "top-status",
        nested: {
          conversation_id: "nested-conversation",
          permission_id: "nested-permission",
          status: "nested-status",
        },
      }).status
    ).toBe(0);
    expect(
      run({
        task_id: "top-task",
        permission_id: "top-task-permission",
        nested: {
          task_id: "nested-task",
          permission_id: "nested-task-permission",
        },
      }).status
    ).toBe(0);

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[0]).not.toHaveProperty("sessionId");
    expect(rows[0]).not.toHaveProperty("interactionId");
    expect(rows[0]).not.toHaveProperty("nativeState");
    expect(rows[1]).toMatchObject({
      interactionId: "top-permission",
      nativeState: "top-status",
      sessionId: "top-conversation",
    });
    expect(rows[2]).toMatchObject({
      interactionId: "top-task-permission",
      sessionId: "top-task",
    });
  });
});
