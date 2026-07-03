import { describe, expect, it } from "vitest";
import { withPanelStatusEnv } from "../../src/main/ipc/terminal-create-launch.ts";

describe("withPanelStatusEnv", () => {
  const hookEnv = {
    PIER_AGENT_EVENT_LOG: "/tmp/pier-agent-events.jsonl",
    PIER_AGENT_HOOKS_DIR: "/tmp/pier-hooks",
  };

  it("无 launch 的普通终端也注入 PIER_WINDOW_ID + PIER_PANEL_ID + hook env", () => {
    const out = withPanelStatusEnv(undefined, "panel-1", "7", hookEnv);
    expect(out.env).toEqual({
      PIER_AGENT_EVENT_LOG: "/tmp/pier-agent-events.jsonl",
      PIER_AGENT_HOOKS_DIR: "/tmp/pier-hooks",
      PIER_PANEL_ID: "panel-1",
      PIER_WINDOW_ID: "7",
    });
  });

  it("保留已有 launch 的 command/cwd/env, PIER_* 覆盖同名键", () => {
    const out = withPanelStatusEnv(
      { command: "claude", cwd: "/w", env: { FOO: "1", PIER_PANEL_ID: "x" } },
      "panel-2",
      "7",
      hookEnv
    );
    expect(out.command).toBe("claude");
    expect(out.cwd).toBe("/w");
    expect(out.env?.FOO).toBe("1");
    expect(out.env?.PIER_PANEL_ID).toBe("panel-2");
    expect(out.env?.PIER_WINDOW_ID).toBe("7");
  });

  it("hookEnv 空时仍注入路由变量（无异常回退）", () => {
    const out = withPanelStatusEnv(undefined, "panel-3", "7", {});
    expect(out.env).toEqual({ PIER_PANEL_ID: "panel-3", PIER_WINDOW_ID: "7" });
  });
});
