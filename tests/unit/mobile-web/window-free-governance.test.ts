// @vitest-environment node
/**
 * 移动端不组装 agentRef（makeAgentRef / parseAgentRef 只在宿主 main）。
 * 会话地址是 panel + window，因为 panelId 跨窗口不唯一。
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

describe("不变量：移动端不组装 agentRef；会话带 window 消歧", () => {
  it("源码不组装/解析 agent ref", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      expect(source.includes("makeAgentRef"), path).toBe(false);
      expect(source.includes("parseAgentRef"), path).toBe(false);
    }
  });

  it("会话路由按 panel 与 window 参数寻址", () => {
    const routes = readFileSync(join(MOBILE_SRC, "lib/routes.ts"), "utf8");
    expect(routes).toContain("/session?panel=");
    expect(routes).toContain("&window=");
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
