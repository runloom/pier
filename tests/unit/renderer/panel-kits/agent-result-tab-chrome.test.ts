import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import { stripPanelTabChromeState } from "@shared/contracts/terminal/end-state.ts";
import { describe, expect, it } from "vitest";
import {
  agentResultTabChromeOverlay,
  mergeTabChrome,
  tabChromeForAgentResultBase,
} from "@/panel-kits/terminal/tab-chrome.ts";

describe("agent result tab chrome (no success check on clean exit)", () => {
  function succeededBase(): PanelTabChrome {
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

  it("strips success state from base on clean exit", () => {
    const base = tabChromeForAgentResultBase(succeededBase(), {
      exitCode: 0,
      exited: true,
    });
    expect(base?.state).toBeUndefined();
    expect(base?.icon?.id).toBe("agent:claude");
    expect(base?.title).toBe("pier");
  });

  it("strips success when exit code is unknown", () => {
    const base = tabChromeForAgentResultBase(succeededBase(), {
      exited: true,
    });
    expect(base?.state).toBeUndefined();
  });

  it("keeps failed chrome for non-zero exit", () => {
    const failed: PanelTabChrome = {
      state: {
        colorToken: "destructive",
        label: "Exited 42",
        status: "failed",
      },
      title: "pier",
    };
    const base = tabChromeForAgentResultBase(failed, {
      exitCode: 42,
      exited: true,
    });
    expect(base?.state?.status).toBe("failed");
  });

  it("merged residual overlay has no status indicator on clean exit", () => {
    const base = tabChromeForAgentResultBase(succeededBase(), {
      exitCode: 0,
      exited: true,
    });
    const merged = mergeTabChrome(
      base,
      agentResultTabChromeOverlay("claude", {
        exitCode: 0,
        exited: true,
        title: "pier",
      })
    );
    expect(merged?.state).toBeUndefined();
    expect(merged?.icon?.id).toBe("agent:claude");
    expect(merged?.title).toBe("pier");
  });

  it("residual overlay marks failed only for non-zero exit", () => {
    const merged = mergeTabChrome(
      stripPanelTabChromeState(succeededBase()),
      agentResultTabChromeOverlay("claude", {
        exitCode: 2,
        exited: true,
      })
    );
    expect(merged?.state?.status).toBe("failed");
    expect(merged?.state?.colorToken).toBe("destructive");
  });

  it("stripPanelTabChromeState drops only state", () => {
    expect(stripPanelTabChromeState(succeededBase())).toEqual({
      icon: { id: "agent:claude" },
      title: "pier",
    });
  });
});
