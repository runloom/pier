import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, describe, expect, it } from "vitest";
import * as agentHooksInstallModule from "../../../../src/main/services/agents/hooks-install.ts";
import {
  agentHooksDir,
  atomicReplaceSymlink,
  buildDeriveClaudeSessionTitleScript,
  buildExtractStdinMetaScript,
  DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME,
  deriveClaudeSessionTitleScriptPath,
  EXTRACT_STDIN_META_SCRIPT_NAME,
  emitScriptPath,
  eventsJsonlPath,
  extractStdinMetaScriptPath,
  installAgentHooksEmitScript,
  isPierHooksCurrentSymlink,
  PIER_HOOK_COMMAND_GENERATION,
  pierHooksCurrentDir,
  pierHooksHomeDir,
  pierHooksVersionDir,
  readInstalledHookRuntimeGeneration,
} from "../../../../src/main/services/agents/hooks-install.ts";

type RuntimeInstallLock = <T>(
  hooksHome: string,
  operation: () => Promise<T>,
  options?: {
    acquireTimeoutMs?: number;
    delay?: (ms: number) => Promise<void>;
  }
) => Promise<T>;

function runtimeInstallLock(): RuntimeInstallLock {
  return (
    agentHooksInstallModule as typeof agentHooksInstallModule & {
      withAgentHooksInstallLock?: RuntimeInstallLock;
    }
  ).withAgentHooksInstallLock as RuntimeInstallLock;
}

describe("installAgentHooksEmitScript（共享 ~/.pier/hooks 运行时）", () => {
  it("严格 v3 运行时使用受管世代 10", () => {
    expect(PIER_HOOK_COMMAND_GENERATION).toBe(10);
  });

  it("返回可区分的安装结果", async () => {
    const root = await makeTempDir();
    const hooksHome = join(root, "hooks");
    await expect(
      installAgentHooksEmitScript(join(root, "userData"), { hooksHome })
    ).resolves.toBe("installed");
    await mkdir(join(hooksHome, "v11"), { recursive: true });
    await atomicReplaceSymlink(join(hooksHome, "current"), "v11");
    await writeFile(join(hooksHome, "GENERATION"), "11\n", "utf8");
    await expect(
      installAgentHooksEmitScript(join(root, "userData"), { hooksHome })
    ).resolves.toBe("skipped-newer");
  });

  let baseDir: string | null = null;

  async function makeTempDir(): Promise<string> {
    const { mkdtemp } = await import("node:fs/promises");
    const dir = await mkdtemp(join(tmpdir(), "pier-hooks-install-"));
    baseDir = dir;
    return dir;
  }

  async function installPair(root: string) {
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    return { userData, hooksHome };
  }

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { force: true, recursive: true });
      baseDir = null;
    }
  });

  it("跨进程文件锁串行化同一 hooksHome，等待由受控闸门驱动", async () => {
    const root = await makeTempDir();
    const hooksHome = join(root, "hooks");
    const withLock = runtimeInstallLock();
    expect(withLock).toBeTypeOf("function");
    const firstEntered = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const secondContended = Promise.withResolvers<void>();
    const retrySecond = Promise.withResolvers<void>();
    const order: string[] = [];

    const first = withLock(hooksHome, async () => {
      order.push("first-enter");
      firstEntered.resolve();
      await releaseFirst.promise;
      order.push("first-exit");
    });
    await firstEntered.promise;

    const second = withLock(
      hooksHome,
      async () => {
        order.push("second-enter");
      },
      {
        acquireTimeoutMs: 30_000,
        delay: async () => {
          secondContended.resolve();
          await retrySecond.promise;
        },
      }
    );
    await secondContended.promise;
    expect(order).toEqual(["first-enter"]);

    releaseFirst.resolve();
    await first;
    retrySecond.resolve();
    await second;
    expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
  });

  it("并发较高世代发布后，v10 在锁内重读并拒绝降级", async () => {
    const root = await makeTempDir();
    const hooksHome = join(root, "hooks");
    const userData = join(root, "userData");
    const withLock = runtimeInstallLock();
    const firstEntered = Promise.withResolvers<void>();
    const publishHigher = Promise.withResolvers<void>();
    const secondContended = Promise.withResolvers<void>();
    const retrySecond = Promise.withResolvers<void>();

    const higherInstall = withLock(hooksHome, async () => {
      firstEntered.resolve();
      await publishHigher.promise;
      await mkdir(join(hooksHome, "v11"), { recursive: true });
      await atomicReplaceSymlink(join(hooksHome, "current"), "v11");
      await writeFile(join(hooksHome, "GENERATION"), "11\n", "utf8");
    });
    await firstEntered.promise;

    const lowerInstall = installAgentHooksEmitScript(userData, {
      hooksHome,
      lockOptions: {
        acquireTimeoutMs: 30_000,
        delay: async () => {
          secondContended.resolve();
          await retrySecond.promise;
        },
      },
    } as {
      hooksHome: string;
      lockOptions: {
        acquireTimeoutMs: number;
        delay: () => Promise<void>;
      };
    });
    const firstOutcome = await Promise.race([
      secondContended.promise.then(() => "contended" as const),
      lowerInstall.then(() => "finished" as const),
    ]);

    publishHigher.resolve();
    await higherInstall;
    retrySecond.resolve();
    await expect(lowerInstall).resolves.toBe("skipped-newer");

    expect(firstOutcome).toBe("contended");
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(11);
    expect(await readlink(join(hooksHome, "current"))).toBe("v11");
  });

  it("较高世代已切换 current 但 GENERATION 尚未落盘时仍不可降级", async () => {
    const root = await makeTempDir();
    const hooksHome = join(root, "hooks");
    await mkdir(join(hooksHome, "v11"), { recursive: true });
    await atomicReplaceSymlink(join(hooksHome, "current"), "v11");
    await writeFile(join(hooksHome, "GENERATION"), "10\n", "utf8");

    await expect(
      installAgentHooksEmitScript(join(root, "userData"), { hooksHome })
    ).resolves.toBe("skipped-newer");

    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(11);
    expect(await readlink(join(hooksHome, "current"))).toBe("v11");
  });

  it("emit 脚本写入 current 且 chmod 755，current 为指向 vN 的 symlink", async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const scriptPath = emitScriptPath(hooksHome);
    const st = await stat(scriptPath);
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode 位掩码语义就该用 &
    expect(st.mode & 0o777).toBe(0o755);
    expect(st.isFile()).toBe(true);
    expect(await isPierHooksCurrentSymlink(hooksHome)).toBe(true);
    expect(await readlink(pierHooksCurrentDir(hooksHome))).toBe(
      `v${PIER_HOOK_COMMAND_GENERATION}`
    );
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(
      PIER_HOOK_COMMAND_GENERATION
    );
  });

  it("extract/derive 为 #!/usr/bin/env node 纯脚本（无 Electron 路径）", async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    for (const scriptPath of [
      extractStdinMetaScriptPath(hooksHome),
      deriveClaudeSessionTitleScriptPath(hooksHome),
    ]) {
      const st = await stat(scriptPath);
      // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode 位掩码
      expect(st.mode & 0o777).toBe(0o755);
      const content = await readFile(scriptPath, "utf8");
      expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
      expect(content).not.toContain("ELECTRON_RUN_AS_NODE");
      expect(content).not.toContain(process.execPath);
      expect(content).not.toMatch(/\/Users\/|\/Applications\//);
      expect(content).toContain(
        `pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`
      );
    }
  });

  it("emit 内容包含三 kind case 分支", async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const content = await readFile(emitScriptPath(hooksHome), "utf8");
    expect(content.startsWith("#!/bin/sh\n")).toBe(true);
    expect(content).toContain('[ -z "$PIER_PANEL_ID" ] && exit 0');
    expect(content).toContain('[ -z "$PIER_WINDOW_ID" ] && exit 0');
    expect(content).toContain('case "$1" in');
    expect(content).toContain("commandStart)");
    expect(content).toContain("commandFinished)");
    expect(content).toContain("agentEvent)");
    expect(content).toContain("agentEventV2)");
    expect(content).toContain('"v":1');
    expect(content).toContain('"v":2');
    expect(content).toContain('"kind":"commandStart"');
    expect(content).toContain('"kind":"commandFinished"');
    expect(content).toContain('"kind":"agentEvent"');
    expect(content).toContain("date +%s%N");
    expect(content).toContain("date +%s000000000");
    expect(content).toContain(">> ");
  });

  it("旧 agentEventV2 位置参数继续写出可解析的 v2 行", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const r = spawnSync(
      "/bin/sh",
      [emitScriptPath(hooksHome), "agentEventV2", "claude", "Stop", "Stop"],
      {
        env: {
          ...process.env,
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
          PIER_AGENT_EVENT_LOG: logPath,
        },
      }
    );
    expect(r.status).toBe(0);
    const line = (await readFile(logPath, "utf8")).trim();
    expect(agentHookEventSchema.parse(JSON.parse(line))).toMatchObject({
      agent: "claude",
      event: "Stop",
      kind: "agentEvent",
      panelId: "p1",
      v: 2,
    });
  });

  it("旧 agentEvent 位置参数继续写出可解析的 v1 行", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const result = spawnSync(
      "/bin/sh",
      [
        emitScriptPath(hooksHome),
        "agentEvent",
        "claude",
        "ToolStart",
        "session-1",
        "turn-1",
        "tool-1",
        "Shell",
        "worker-1",
        "researcher",
        "/tmp/transcript.jsonl",
        Buffer.from("{}").toString("base64"),
      ],
      {
        env: {
          ...process.env,
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
        },
      }
    );
    expect(result.status).toBe(0);
    expect(
      agentHookEventSchema.parse(
        JSON.parse((await readFile(logPath, "utf8")).trim())
      )
    ).toMatchObject({
      event: "ToolStart",
      sessionId: "session-1",
      toolUseId: "tool-1",
      v: 1,
    });
  });

  it("agentEventV3 spawn 写出可被严格 schema 解析的标准与交互事件", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const run = (...args: string[]) =>
      spawnSync("/bin/sh", [emitScriptPath(hooksHome), ...args], { env });

    expect(
      run(
        "agentEventV3",
        "claude",
        "ToolStart",
        "PreToolUse",
        'session-"quoted"\\value\n',
        "turn-1",
        "tool-1",
        "Shell",
        "worker-1",
        "researcher",
        "/tmp/transcript.jsonl",
        Buffer.from('{"promptSnippet":"hello"}').toString("base64"),
        "parent-1",
        "subagent",
        "busy",
        "must-be-removed",
        "permission",
        "accepted",
        "hello"
      ).status
    ).toBe(0);
    expect(
      run(
        "agentEventV3",
        "claude",
        "InteractionRequested",
        "PermissionRequest",
        "session-1",
        "turn-1",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "main",
        "",
        "permission-1",
        "permission",
        "accepted-must-be-removed",
        ""
      ).status
    ).toBe(0);
    expect(
      run(
        "agentEventV3",
        "claude",
        "InteractionResolved",
        "PermissionResult",
        "session-1",
        "turn-1",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "main",
        "",
        "permission-1",
        "permission",
        "accepted",
        ""
      ).status
    ).toBe(0);

    const raw = await readFile(logPath, "utf8").catch(() => "");
    expect(raw).not.toBe("");
    const rows = raw
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      actorHint: "subagent",
      event: "ToolStart",
      nativeEvent: "PreToolUse",
      nativeState: "busy",
      parentSessionId: "parent-1",
      promptSnippet: "hello",
      sessionId: 'session-"quoted"\\value',
      toolUseId: "tool-1",
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
    expect(rows[0]).not.toHaveProperty("interactionId");
    expect(rows[1]).not.toHaveProperty("interactionOutcome");
    expect(rows[2]).not.toHaveProperty("toolName");
  });

  it("agentEventV3 字段按 UTF-8 边界截断，不写入替换字符", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const result = spawnSync(
      "/bin/sh",
      [
        emitScriptPath(hooksHome),
        "agentEventV3",
        "claude",
        "PromptSubmit",
        "UserPromptSubmit",
        `${"x".repeat(126)}😀`,
      ],
      {
        env: {
          ...process.env,
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
        },
      }
    );
    expect(result.status).toBe(0);
    const event = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    expect(event).toMatchObject({
      sessionId: "x".repeat(126),
      v: 3,
    });
    expect(JSON.stringify(event)).not.toContain("\uFFFD");
  });

  it("commandStart / commandFinished spawn 写 JSONL", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
      PIER_AGENT_EVENT_LOG: logPath,
    };
    expect(
      spawnSync(
        "/bin/sh",
        [emitScriptPath(hooksHome), "commandStart", 'ls "foo" \\bar'],
        { env }
      ).status
    ).toBe(0);
    expect(
      spawnSync(
        "/bin/sh",
        [emitScriptPath(hooksHome), "commandFinished", "137"],
        { env }
      ).status
    ).toBe(0);
    const lines = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const start = JSON.parse(lines[0] ?? "{}") as { kind: string };
    const fin = JSON.parse(lines[1] ?? "{}") as {
      kind: string;
      exitCode: number;
    };
    expect(start.kind).toBe("commandStart");
    expect(fin.kind).toBe("commandFinished");
    expect(fin.exitCode).toBe(137);
  });

  it("未知 kind 静默 no-op 且不写日志", { timeout: 15_000 }, async () => {
    const root = await makeTempDir();
    const { userData, hooksHome } = await installPair(root);
    const logPath = eventsJsonlPath(userData);
    const r = spawnSync(
      "/bin/sh",
      [emitScriptPath(hooksHome), "bogusKind", "x"],
      {
        env: {
          ...process.env,
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
          PIER_AGENT_EVENT_LOG: logPath,
        },
      }
    );
    expect(r.status).toBe(0);
    const exists = await stat(logPath).then(
      (s) => s.size > 0,
      () => false
    );
    expect(exists).toBe(false);
  });

  it("幂等：重复安装覆盖写入不抛错", async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const content1 = await readFile(emitScriptPath(hooksHome), "utf8");
    await installAgentHooksEmitScript(join(root, "userData"), { hooksHome });
    const content2 = await readFile(emitScriptPath(hooksHome), "utf8");
    expect(content2).toBe(content1);
  });

  it("旧客户端（更低 gen）不得降级更高世代运行时", async () => {
    const root = await makeTempDir();
    const hooksHome = join(root, "hooks");
    const userData = join(root, "userData");
    // 先伪造更高世代
    const high = PIER_HOOK_COMMAND_GENERATION + 1;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(pierHooksVersionDir(high, hooksHome), { recursive: true });
    await writeFile(
      join(pierHooksVersionDir(high, hooksHome), "emit"),
      "#!/bin/sh\necho high\n",
      { mode: 0o755 }
    );
    await writeFile(join(hooksHome, "GENERATION"), `${high}\n`);
    const { symlink } = await import("node:fs/promises");
    await symlink(`v${high}`, pierHooksCurrentDir(hooksHome));

    await installAgentHooksEmitScript(userData, { hooksHome });
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(high);
    expect(await readlink(pierHooksCurrentDir(hooksHome))).toBe(`v${high}`);
    // 不得创建/切换到本世代
    const content = await readFile(
      join(pierHooksVersionDir(high, hooksHome), "emit"),
      "utf8"
    );
    expect(content).toContain("echo high");
  });

  it("同世代内容相同不重写字节，但恢复可执行位", async () => {
    const root = await makeTempDir();
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const path = extractStdinMetaScriptPath(hooksHome);
    const bodyBefore = await readFile(path, "utf8");
    const { chmod } = await import("node:fs/promises");
    await chmod(path, 0o644);
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode
    expect((await stat(path)).mode & 0o777).toBe(0o644);
    await installAgentHooksEmitScript(userData, { hooksHome });
    expect(await readFile(path, "utf8")).toBe(bodyBefore);
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode
    expect((await stat(path)).mode & 0o777).toBe(0o755);
    expect(await readInstalledHookRuntimeGeneration(hooksHome)).toBe(
      PIER_HOOK_COMMAND_GENERATION
    );
  });

  it("路径辅助函数返回正确子路径", () => {
    expect(agentHooksDir("/data")).toBe(join("/data", "agent-hooks"));
    expect(eventsJsonlPath("/data")).toBe(
      join("/data", "agent-hooks", "events.jsonl")
    );
    expect(pierHooksHomeDir("/home/u")).toBe(join("/home/u", ".pier", "hooks"));
    expect(pierHooksCurrentDir("/h")).toBe(join("/h", "current"));
    expect(emitScriptPath("/h")).toBe(join("/h", "current", "emit"));
    expect(extractStdinMetaScriptPath("/h")).toBe(
      join("/h", "current", EXTRACT_STDIN_META_SCRIPT_NAME)
    );
    expect(deriveClaudeSessionTitleScriptPath("/h")).toBe(
      join("/h", "current", DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME)
    );
    expect(pierHooksVersionDir(5, "/h")).toBe(join("/h", "v5"));
  });

  it("extract-stdin-meta spawn：抽出 session_id + promptSnippet", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const prompt = "帮我分析下当前未提交的修改";
    const input = JSON.stringify({
      session_id: "sess-1",
      turnId: "turn-2",
      prompt,
    });
    // 直接执行（尊重 shebang），模拟 hooks.json 里 `"$PIER_AGENT_HOOKS_DIR/extract…"`
    const r = spawnSync(extractStdinMetaScriptPath(hooksHome), [], {
      input,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
    const meta = JSON.parse(
      Buffer.from(r.stdout.trim(), "base64").toString("utf8")
    ) as Record<string, unknown>;
    expect(meta.session_id).toBe("sess-1");
    expect(meta.turnId).toBe("turn-2");
    expect(meta.promptSnippet).toBe(prompt.slice(0, MAX_PROMPT_SNIPPET_LENGTH));
  });

  it("extract-stdin-meta spawn：保留已审计身份别名但不收任意 id", async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const input = {
      conversation_id: "conversation-1",
      conversationId: "conversation-2",
      id: "generic-id",
      parent_session_id: "parent-1",
      parentSessionId: "parent-2",
      task_id: "task-1",
      taskId: "task-2",
      tool_call_id: "tool-call-1",
      toolCallId: "tool-call-2",
    };
    const result = spawnSync(extractStdinMetaScriptPath(hooksHome), [], {
      encoding: "utf8",
      input: JSON.stringify(input),
    });
    expect(result.status).toBe(0);
    const metadata = JSON.parse(
      Buffer.from(result.stdout.trim(), "base64").toString("utf8")
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      conversation_id: "conversation-1",
      conversationId: "conversation-2",
      parent_session_id: "parent-1",
      parentSessionId: "parent-2",
      task_id: "task-1",
      taskId: "task-2",
      tool_call_id: "tool-call-1",
      toolCallId: "tool-call-2",
    });
    expect(metadata).not.toHaveProperty("id");
  }, 15_000);

  it("derive-claude-session-title spawn：标题 / 原样保留 / 超长截断", {
    timeout: 15_000,
  }, async () => {
    const root = await makeTempDir();
    const { hooksHome } = await installPair(root);
    const script = deriveClaudeSessionTitleScriptPath(hooksHome);

    const run = (prompt: string) =>
      spawnSync(script, [], {
        input: JSON.stringify({ prompt }),
        encoding: "utf8",
      });

    const ok = run("帮我修一下 parser 崩溃");
    expect(ok.status).toBe(0);
    const okBody = JSON.parse(ok.stdout) as {
      hookSpecificOutput?: { sessionTitle?: string };
    };
    expect(okBody.hookSpecificOutput?.sessionTitle).toBe(
      "帮我修一下 parser 崩溃"
    );

    // 确定性派生：不判断寒暄。用户写 "hi" 就叫 "hi"，随时可改名。
    const greeting = run("hi");
    expect(greeting.status).toBe(0);
    const greetingBody = JSON.parse(greeting.stdout) as {
      hookSpecificOutput?: { sessionTitle?: string };
    };
    expect(greetingBody.hookSpecificOutput?.sessionTitle).toBe("hi");

    const long = "a".repeat(MAX_AGENT_SESSION_TITLE_LENGTH + 20);
    const capped = run(long);
    expect(capped.status).toBe(0);
    const capBody = JSON.parse(capped.stdout) as {
      hookSpecificOutput?: { sessionTitle?: string };
    };
    const title = capBody.hookSpecificOutput?.sessionTitle;
    expect(title).toBeDefined();
    expect(title?.length).toBeLessThanOrEqual(MAX_AGENT_SESSION_TITLE_LENGTH);
    expect(title?.endsWith("…")).toBe(true);

    const markup = run("<user_query>cmd + p 会先展示 loading</user_query>");
    expect(markup.status).toBe(0);
    const markupBody = JSON.parse(markup.stdout) as {
      hookSpecificOutput?: { sessionTitle?: string };
    };
    expect(markupBody.hookSpecificOutput?.sessionTitle).toBe(
      "cmd + p 会先展示 loading"
    );
  });

  it("build*Script 为纯 node shebang 且跨调用内容稳定", () => {
    expect(buildExtractStdinMetaScript()).toBe(buildExtractStdinMetaScript());
    expect(buildDeriveClaudeSessionTitleScript()).toBe(
      buildDeriveClaudeSessionTitleScript()
    );
    for (const content of [
      buildExtractStdinMetaScript(),
      buildDeriveClaudeSessionTitleScript(),
    ]) {
      expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
      expect(content).not.toContain("ELECTRON_RUN_AS_NODE");
      expect(content).not.toContain(process.execPath);
    }
  });
});
