/**
 * 终态生命周期治理：退出不卸 hooks；启动走 installAgentHooksStack 同事务。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("agent hooks lifecycle governance", () => {
  it("closeForegroundActivityResources 不调用 uninstall", () => {
    const src = readSrc("src/main/ipc/foreground-activity.ts");
    const closeFn = src.slice(
      src.indexOf("export function closeForegroundActivityResources")
    );
    const body = closeFn.slice(
      0,
      closeFn.indexOf("\nexport function registerForegroundActivityIpc")
    );
    expect(body).toContain("jsonlObserver");
    expect(body).not.toContain("uninstallAllAgentHooks");
    expect(body).not.toContain("installAgentHooks");
  });

  it("启动路径使用 installAgentHooksStack（运行时 + 全局配置同序）", () => {
    const src = readSrc("src/main/ipc/foreground-activity.ts");
    expect(src).toContain("installAgentHooksStack");
    expect(src).toContain("prefs.agentStatusHooks");
    // 不得再单独 fire-and-forget 装 runtime（避免与全局配置竞态）
    expect(src).not.toMatch(
      /installAgentHooksEmitScript\s*\(\s*app\.getPath\s*\(\s*["']userData["']\s*\)/
    );
  });

  it("偏好开关与自愈走 stack；卸载注释锁定不删共享运行时", () => {
    const registry = readSrc(
      "src/main/services/agents/integrations/registry.ts"
    );
    expect(registry).toContain("export async function installAgentHooksStack");
    expect(registry).toMatch(
      /applyAgentStatusHooksPreference[\s\S]*installAgentHooksStack/
    );
    expect(registry).toContain("export async function uninstallAllAgentHooks");
    // 卸载注释在函数声明之前：关偏好/退出不得删共享运行时
    expect(registry).toMatch(/不删除[\s\S]*\.pier\/hooks/);

    // session-title 不再为 PromptSubmit 自愈装 hooks（tab 标题走 OSC / cwd）。
    const sessionTitle = readSrc(
      "src/main/services/agents/session-title/index.ts"
    );
    expect(sessionTitle).not.toContain("installAgentHooksStack");
    expect(sessionTitle).not.toContain("selfHealAgentHooksIfNeeded");
    expect(sessionTitle).not.toContain("deriveFromPromptSubmit");
  });

  it("PTY 注入共享 current 与实例私有 event log", () => {
    const src = readSrc("src/main/ipc/foreground-activity.ts");
    expect(src).toContain("pierHooksCurrentDir");
    expect(src).toContain("eventsJsonlPath");
    expect(src).toContain("PIER_AGENT_HOOKS_DIR");
    expect(src).toContain("PIER_AGENT_EVENT_LOG");
  });
});
