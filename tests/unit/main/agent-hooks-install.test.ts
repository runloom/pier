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

  it("emit 内容包含关键 printf 和 JSONL 格式", async () => {
    const dir = await makeTempDir();
    await installAgentHooksEmitScript(dir);
    const content = await readFile(emitScriptPath(dir), "utf8");
    // shebang
    expect(content.startsWith("#!/bin/sh\n")).toBe(true);
    // PIER_PANEL_ID guard（非 Pier 启动直接退出）
    expect(content).toContain('[ -z "$PIER_PANEL_ID" ] && exit 0');
    // JSONL printf 模板
    expect(content).toContain("printf ");
    expect(content).toContain('"v":1');
    expect(content).toContain('"agent"');
    expect(content).toContain('"event"');
    expect(content).toContain('"panelId"');
    // macOS date fallback
    expect(content).toContain("date +%s%N");
    expect(content).toContain("date +%s000000000");
    // append 模式
    expect(content).toContain(">> ");
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
