// @vitest-environment node
/**
 * 移动端无窗口治理：窗口是桌面布局概念，移动端只有「面板即会话地址」。
 * - apps/mobile-web/src 源码禁止出现 windowId（读窗口字段 / 组装引用都算泄漏）；
 * - 禁止 ref 组装/解析（makeAgentRef / parseAgentRef 的消费只在宿主 main）；
 * - 会话路由参数锁定 panel（与宿主 Web Push 深链同构）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOBILE_SRC = join(process.cwd(), "apps/mobile-web/src");

function sources(): string[] {
  return readdirSync(MOBILE_SRC, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .map((entry) => join(MOBILE_SRC, entry));
}

describe("不变量：移动端无窗口概念（面板即会话地址）", () => {
  it("源码不出现 windowId，也不组装/解析 agent ref", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      expect(source.includes("windowId"), path).toBe(false);
      expect(source.includes("makeAgentRef"), path).toBe(false);
      expect(source.includes("parseAgentRef"), path).toBe(false);
    }
  });

  it("会话路由按 panel 参数寻址", () => {
    const routes = readFileSync(join(MOBILE_SRC, "lib/routes.ts"), "utf8");
    expect(routes).toContain("/session?panel=");
    expect(routes.includes("session?agent=")).toBe(false);
  });

  it("Service Worker 深链只走 payload.path，不用 agent 查询串", () => {
    const sw = readFileSync(
      join(process.cwd(), "apps/mobile-web/public/sw.js"),
      "utf8"
    );
    expect(sw).toContain("payload.path");
    expect(sw.includes("agent=")).toBe(false);
  });
});
