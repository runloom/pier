/**
 * 智能体列表主标题治理——列表与 tab 完全一致（单一实现）。
 *
 * 锁定的不变量：
 * 1. resolveAgentListTitle 优先级与 tab short 完全一致：已解析 tab short →
 *    user 钉名 → cwd 叶子名 → provider 标题 → catalog 标签。
 * 2. Index quickpick / 活动总览行 / 协作会话列表只经 resolveAgentListTitle
 *    取主标题，不得各自 resolveAgentSessionTitle（否则列表与 tab 漂移）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentListTitle } from "@/lib/agent-runtime/list-title.ts";

const REPO_ROOT = process.cwd();

const LIST_SURFACES = [
  "src/renderer/lib/agent-runtime/index-quickpick.ts",
  "src/renderer/lib/agent-runtime/collab-view-model.ts",
];

describe("resolveAgentListTitle (list == tab)", () => {
  it("prefers the resolved tab short verbatim over every product title", () => {
    expect(
      resolveAgentListTitle({
        agentId: "claude",
        cwd: "/repo/pier",
        sessionTitle: "Review PR",
        sessionTitleSource: "user",
        tabShort: "nvim",
      })
    ).toBe("nvim");
  });

  it("passes through tab short 'Terminal' (exact tab display)", () => {
    expect(
      resolveAgentListTitle({ agentId: "codex", tabShort: "Terminal" })
    ).toBe("Terminal");
  });

  it("ignores blank tab short and falls back to the user pin", () => {
    expect(
      resolveAgentListTitle({
        agentId: "claude",
        sessionTitle: "My rename",
        sessionTitleSource: "user",
        tabShort: "  ",
      })
    ).toBe("My rename");
  });

  it("falls back to cwd basename before provider title", () => {
    expect(
      resolveAgentListTitle({
        agentId: "claude",
        cwd: "/repo/feat-bug-20260823",
        sessionTitle: "Fix parser crash",
        sessionTitleSource: "provider",
      })
    ).toBe("feat-bug-20260823");
  });

  it("falls back to provider title when no path is available", () => {
    expect(
      resolveAgentListTitle({
        agentId: "claude",
        sessionTitle: "Fix parser crash",
        sessionTitleSource: "provider",
      })
    ).toBe("Fix parser crash");
  });

  it("falls back to catalog label as the last resort", () => {
    expect(resolveAgentListTitle({ agentId: "codex" })).toBe("Codex");
  });
});

describe("list title single implementation", () => {
  it("all list surfaces resolve their primary through resolveAgentListTitle", () => {
    for (const rel of LIST_SURFACES) {
      const source = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(source, rel).toContain("resolveAgentListTitle");
      // 列表主标题不得绕过共享 resolver 直接走产品 sessionTitle。
      expect(source, rel).not.toContain("resolveAgentSessionTitle");
    }
  });

  it("tab short resolution stays single-source in terminal tab chrome", () => {
    const chrome = readFileSync(
      join(REPO_ROOT, "src/renderer/panel-kits/terminal/tab-chrome.ts"),
      "utf8"
    );
    expect(chrome).toContain("terminalPanelDescriptor");
    // 列表只消费已解析 short，不得 import / 重算 tab-chrome 的 OSC 解析链。
    const resolver = readFileSync(
      join(REPO_ROOT, "src/renderer/lib/agent-runtime/list-title.ts"),
      "utf8"
    );
    expect(resolver).not.toMatch(/from ["'][^"']*tab-chrome/);
    expect(resolver).not.toContain("pathLikeTerminalTitle");
    expect(resolver).not.toContain("tabShortFromTerminalTitle");
  });

  it("tab short map building is shared, not reimplemented per list", () => {
    const quickpick = readFileSync(
      join(
        REPO_ROOT,
        "src/renderer/lib/agent-runtime/open-agent-index-quickpick.tsx"
      ),
      "utf8"
    );
    const collab = readFileSync(
      join(
        REPO_ROOT,
        "src/renderer/lib/agent-runtime/collaboration-dialog.tsx"
      ),
      "utf8"
    );
    expect(quickpick).toContain("tabShortByPanelIdFrom");
    expect(collab).toContain("tabShortByPanelIdFrom");
    // 不得再各自手写 display.short 映射循环。
    expect(collab).not.toContain("descriptor.display?.short");
  });
});
