import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTargetAgentPanelFocused } from "@main/ipc/notification-center-agent-focus.ts";
import { describe, expect, it } from "vitest";

describe("isTargetAgentPanelFocused", () => {
  it("is false when key window is missing", () => {
    expect(
      isTargetAgentPanelFocused({
        activeTerminalPanelId: "terminal-agent",
        focusedElectronWindowId: null,
        ownerElectronWindowId: "1",
        panelId: "terminal-agent",
      })
    ).toBe(false);
  });

  it("is false when owner window is not the key window", () => {
    expect(
      isTargetAgentPanelFocused({
        activeTerminalPanelId: "terminal-agent",
        focusedElectronWindowId: "2",
        ownerElectronWindowId: "1",
        panelId: "terminal-agent",
      })
    ).toBe(false);
  });

  it("is true only when active terminal matches the agent panel", () => {
    expect(
      isTargetAgentPanelFocused({
        activeTerminalPanelId: "terminal-agent",
        focusedElectronWindowId: "1",
        ownerElectronWindowId: "1",
        panelId: "terminal-agent",
      })
    ).toBe(true);
    expect(
      isTargetAgentPanelFocused({
        activeTerminalPanelId: "terminal-other",
        focusedElectronWindowId: "1",
        ownerElectronWindowId: "1",
        panelId: "terminal-agent",
      })
    ).toBe(false);
  });

  it("treats web base (activeTerminalPanelId=null) as unfocused even if activePanelId residual would be the agent", () => {
    // 模拟 rAF 滞后：activePanelId 仍是 agent，但 activeTerminalPanelId 已为 null。
    // 本函数故意不接收 activePanelId——残留不得再触发 panel-unfocused 静音。
    expect(
      isTargetAgentPanelFocused({
        activeTerminalPanelId: null,
        focusedElectronWindowId: "1",
        ownerElectronWindowId: "1",
        panelId: "terminal-agent",
      })
    ).toBe(false);
  });
});

describe("notification-center ipc wires activeTerminalPanelId", () => {
  it("isTargetPanelFocused path uses isTargetAgentPanelFocused + activeTerminalPanelId", () => {
    const ipc = readFileSync(
      join(process.cwd(), "src/main/ipc/notification-center.ts"),
      "utf8"
    );
    expect(ipc).toContain("isTargetAgentPanelFocused");
    expect(ipc).toContain(
      "terminalFocusCoordinator.activeTerminalPanelId(focused)"
    );
    // 禁止回退到 activePanelId 比较（原 bug：web 切换 rAF 滞后误静音）。
    expect(ipc).not.toMatch(
      /activePanelId\(focused\)\s*===\s*panelId|activePanelId\(focused\)\s*==\s*panelId/
    );
  });
});
