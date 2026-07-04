import { spawnSync } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentHooksDir,
  emitScriptPath,
  eventsJsonlPath,
  installAgentHooksEmitScript,
} from "../../../src/main/services/agents/agent-hooks-install.ts";

describe("installAgentHooksEmitScript", () => {
  let baseDir: string | null = null;

  async function makeTempDir(): Promise<string> {
    const { mkdtemp } = await import("node:fs/promises");
    const dir = await mkdtemp(join(tmpdir(), "pier-hooks-install-"));
    baseDir = dir;
    return dir;
  }

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { force: true, recursive: true });
      baseDir = null;
    }
  });

  it("emit 脚本写入正确路径且 chmod 755", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const scriptPath = emitScriptPath(dir);
    const st = await stat(scriptPath);
    // 检查可执行位（owner rwx = 0o755 → mode & 0o777 === 0o755）
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX mode 位掩码语义就该用 &
    expect(st.mode & 0o777).toBe(0o755);
    expect(st.isFile()).toBe(true);
  });

  it("emit 内容包含三 kind case 分支", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const content = await readFile(emitScriptPath(dir), "utf8");
    // shebang
    expect(content.startsWith("#!/bin/sh\n")).toBe(true);
    // PIER_PANEL_ID / PIER_WINDOW_ID guard（非 Pier 启动直接退出）
    expect(content).toContain('[ -z "$PIER_PANEL_ID" ] && exit 0');
    expect(content).toContain('[ -z "$PIER_WINDOW_ID" ] && exit 0');
    // 三 kind dispatch
    expect(content).toContain('case "$1" in');
    expect(content).toContain("commandStart)");
    expect(content).toContain("commandFinished)");
    expect(content).toContain("agentEvent)");
    // JSONL printf 模板（保序字段）
    expect(content).toContain('"v":1');
    expect(content).toContain('"kind":"commandStart"');
    expect(content).toContain('"kind":"commandFinished"');
    expect(content).toContain('"kind":"agentEvent"');
    // macOS date fallback
    expect(content).toContain("date +%s%N");
    expect(content).toContain("date +%s000000000");
    // append 模式
    expect(content).toContain(">> ");
  });

  it("agentEvent kind spawn 写出合法 JSONL 行", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const logPath = join(dir, "events.jsonl");
    const r = spawnSync(
      "/bin/sh",
      [emitScriptPath(dir), "agentEvent", "claude", "Stop"],
      {
        env: {
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
          PIER_AGENT_EVENT_LOG: logPath,
        },
      }
    );
    expect(r.status).toBe(0);
    const content = await readFile(logPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.v).toBe(1);
    expect(parsed.kind).toBe("agentEvent");
    expect(parsed.agent).toBe("claude");
    expect(parsed.event).toBe("Stop");
    expect(parsed.panelId).toBe("p1");
    expect(parsed.windowId).toBe("w1");
    expect(typeof parsed.pid).toBe("number");
  });

  it("commandStart kind spawn 写出合法 JSONL + 命令行转义", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const logPath = join(dir, "events.jsonl");
    const r = spawnSync(
      "/bin/sh",
      [emitScriptPath(dir), "commandStart", 'ls "foo" \\bar'],
      {
        env: {
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
          PIER_AGENT_EVENT_LOG: logPath,
        },
      }
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse((await readFile(logPath, "utf8")).trim());
    expect(parsed.kind).toBe("commandStart");
    // 反斜杠双转义 + 双引号转义 → JSON 解析回原文
    expect(parsed.commandLine).toBe('ls "foo" \\bar');
  });

  it("commandFinished kind spawn 写出合法 JSONL + exit code", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const logPath = join(dir, "events.jsonl");
    const r = spawnSync(
      "/bin/sh",
      [emitScriptPath(dir), "commandFinished", "137"],
      {
        env: {
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
          PIER_AGENT_EVENT_LOG: logPath,
        },
      }
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse((await readFile(logPath, "utf8")).trim());
    expect(parsed.kind).toBe("commandFinished");
    expect(parsed.exitCode).toBe(137);
  });

  it("未知 kind → 静默 no-op（无日志行写入）", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const logPath = join(dir, "events.jsonl");
    const r = spawnSync("/bin/sh", [emitScriptPath(dir), "bogusKind", "x"], {
      env: {
        PIER_PANEL_ID: "p1",
        PIER_WINDOW_ID: "w1",
        PIER_AGENT_EVENT_LOG: logPath,
      },
    });
    expect(r.status).toBe(0);
    // 文件不存在或为空（case 无匹配 → 无 append）
    const exists = await stat(logPath).then(
      (s) => s.size > 0,
      () => false
    );
    expect(exists).toBe(false);
  });

  it("幂等：重复安装覆盖写入不抛错", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const content1 = await readFile(emitScriptPath(dir), "utf8");
    await installAgentHooksEmitScript(dir);
    const content2 = await readFile(emitScriptPath(dir), "utf8");
    expect(content2).toBe(content1);
  });

  it("目录不存在时自动创建", async () => {
    const dir = await makeTempDir();
    const nestedDir = join(dir, "nested", "deep");
    // agentHooksDir 在 nestedDir 下
    await installAgentHooksEmitScript(nestedDir);
    const st = await stat(emitScriptPath(nestedDir));
    expect(st.isFile()).toBe(true);
  });

  it("路径辅助函数返回正确子路径", () => {
    expect(agentHooksDir("/data")).toBe(join("/data", "agent-hooks"));
    expect(emitScriptPath("/data")).toBe(join("/data", "agent-hooks", "emit"));
    expect(eventsJsonlPath("/data")).toBe(
      join("/data", "agent-hooks", "events.jsonl")
    );
  });
});
