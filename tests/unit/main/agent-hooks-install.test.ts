import { spawnSync } from "node:child_process";
import { readFile, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksDir,
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
} from "../../../src/main/services/agents/agent-hooks-install.ts";

describe("installAgentHooksEmitScript（共享 ~/.pier/hooks 运行时）", () => {
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

  it("agentEvent kind spawn 写出合法 JSONL 行", async () => {
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
    const row = JSON.parse(line) as {
      v: number;
      kind: string;
      panelId: string;
      agent: string;
      event: string;
    };
    expect(row.v).toBe(2);
    expect(row.kind).toBe("agentEvent");
    expect(row.panelId).toBe("p1");
    expect(row.agent).toBe("claude");
    expect(row.event).toBe("Stop");
  });

  it("commandStart / commandFinished spawn 写 JSONL", async () => {
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

  it("未知 kind 静默 no-op 且不写日志", async () => {
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

  it("extract-stdin-meta spawn：抽出 session_id + promptSnippet", async () => {
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

  it("derive-claude-session-title spawn：标题 / 寒暄 / 超长截断", async () => {
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

    const greeting = run("hi");
    expect(greeting.status).toBe(0);
    expect(greeting.stdout.trim()).toBe("");

    const long = "a".repeat(60);
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
