import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import {
  agentEndResultTabChrome,
  agentEndTabHasForbiddenSuccess,
  applyAgentEndTabChrome,
  buildAgentEndTabState,
  buildTaskEndTabState,
  isAgentCleanExit,
  isLegacyAgentSuccessTab,
  materializeAgentEndState,
  materializeTaskEndState,
  mergeTerminalEndState,
  retainPanelForEndRole,
  shouldRetainTerminalResultPanel,
  stripLegacyAgentSuccessTab,
  stripPanelTabChromeState,
  tabChromeForAgentEndBase,
  taskEndTabStatusFromExit,
} from "@shared/contracts/terminal/end-state.ts";
import { describe, expect, it } from "vitest";

describe("terminal-end-state (PR1 pure functions)", () => {
  function succeededChrome(): PanelTabChrome {
    return {
      icon: { id: "agent:claude" },
      state: {
        colorToken: "success",
        label: "Exited",
        status: "succeeded",
      },
      title: "pier",
    };
  }

  it("isAgentCleanExit treats 0 and missing code as clean", () => {
    expect(isAgentCleanExit(0)).toBe(true);
    expect(isAgentCleanExit(undefined)).toBe(true);
    expect(isAgentCleanExit(1)).toBe(false);
  });

  it("buildAgentEndTabState forbids success on clean exit", () => {
    expect(buildAgentEndTabState(0)).toBeUndefined();
    expect(buildAgentEndTabState(undefined)).toBeUndefined();
    expect(buildAgentEndTabState(42)).toMatchObject({
      colorToken: "destructive",
      status: "failed",
      label: "Exited 42",
    });
  });

  it("applyAgentEndTabChrome strips state on clean exit", () => {
    const next = applyAgentEndTabChrome(succeededChrome(), 0);
    expect(next?.state).toBeUndefined();
    expect(next?.icon?.id).toBe("agent:claude");
    expect(next?.title).toBe("pier");
    expect(agentEndTabHasForbiddenSuccess(next)).toBe(false);
  });

  it("applyAgentEndTabChrome sets failed on non-zero", () => {
    const next = applyAgentEndTabChrome(succeededChrome(), 2);
    expect(next?.state?.status).toBe("failed");
  });

  it("tabChromeForAgentEndBase strips only when exited clean", () => {
    expect(
      tabChromeForAgentEndBase(succeededChrome(), { exited: false })?.state
        ?.status
    ).toBe("succeeded");
    expect(
      tabChromeForAgentEndBase(succeededChrome(), {
        exitCode: 0,
        exited: true,
      })?.state
    ).toBeUndefined();
  });

  it("agentEndResultTabChrome clean exit has no status", () => {
    const chrome = agentEndResultTabChrome("claude", {
      exitCode: 0,
      exited: true,
      title: "pier",
    });
    expect(chrome.state).toBeUndefined();
    expect(chrome.icon?.id).toBe("agent:claude");
    expect(agentEndTabHasForbiddenSuccess(chrome)).toBe(false);
  });

  it("agentEndResultTabChrome failed exit has failed state", () => {
    const chrome = agentEndResultTabChrome("claude", {
      exitCode: 3,
      exited: true,
    });
    expect(chrome.state?.status).toBe("failed");
  });

  it("stripLegacyAgentSuccessTab removes historical green check", () => {
    const agent = { status: "exited" as const, exitCode: 0 };
    const tab = succeededChrome();
    expect(isLegacyAgentSuccessTab(tab, agent)).toBe(true);
    const next = stripLegacyAgentSuccessTab(tab, agent);
    expect(next?.state).toBeUndefined();
    expect(next?.title).toBe("pier");
  });

  it("task end still allows succeeded (product decision)", () => {
    expect(taskEndTabStatusFromExit({ code: 0, reason: "process" })).toEqual({
      exitCode: 0,
      status: "succeeded",
    });
    expect(buildTaskEndTabState("succeeded", 0)).toMatchObject({
      status: "succeeded",
      colorToken: "success",
    });
    expect(taskEndTabStatusFromExit({ reason: "user" }).status).toBe(
      "cancelled"
    );
  });

  it("retainPanelForEndRole matches product path A", () => {
    expect(retainPanelForEndRole("agent")).toBe(true);
    expect(retainPanelForEndRole("task")).toBe(true);
    expect(retainPanelForEndRole("taskOutput")).toBe(true);
    expect(retainPanelForEndRole("shell")).toBe(false);
  });

  it("stripPanelTabChromeState drops only state", () => {
    expect(stripPanelTabChromeState(succeededChrome())).toEqual({
      icon: { id: "agent:claude" },
      title: "pier",
    });
  });

  it("materializeAgentEndState clean has no success status", () => {
    const end = materializeAgentEndState({
      agentId: "claude",
      exitCode: 0,
      panelId: "p1",
      title: "pier",
    });
    expect(end.retainPanel).toBe(true);
    expect(end.dismissMode).toBe("explicit");
    expect(end.tab.state).toBeUndefined();
    expect(agentEndTabHasForbiddenSuccess(end.tab)).toBe(false);
  });

  it("mergeTerminalEndState fills exitCode and forbids success", () => {
    const a = materializeAgentEndState({
      agentId: "claude",
      panelId: "p1",
    });
    const b = mergeTerminalEndState(
      a,
      materializeAgentEndState({
        agentId: "claude",
        exitCode: 0,
        panelId: "p1",
      })
    );
    expect(b.exitCode).toBe(0);
    expect(b.tab.state).toBeUndefined();
  });

  it("materializeTaskEndState allows success green check", () => {
    const end = materializeTaskEndState({
      exitCode: 0,
      panelId: "p-task",
      role: "task",
      title: "build",
    });
    expect(end.role).toBe("task");
    expect(end.tab.state?.status).toBe("succeeded");
  });

  it("shouldRetainTerminalResultPanel shared predicate", () => {
    expect(
      shouldRetainTerminalResultPanel({
        hasAgentActivity: false,
        hasAgentSession: false,
        hasEndState: true,
        hasTaskOwnership: false,
        hasTaskParams: false,
        isTaskOutputPanel: false,
      })
    ).toBe(true);
    expect(
      shouldRetainTerminalResultPanel({
        hasAgentActivity: false,
        hasAgentSession: false,
        hasEndState: false,
        hasTaskOwnership: false,
        hasTaskParams: false,
        isTaskOutputPanel: false,
      })
    ).toBe(false);
  });
});
