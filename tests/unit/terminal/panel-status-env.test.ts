import { describe, expect, it } from "vitest";
import { withPanelStatusEnv } from "../../../src/main/ipc/terminal/create-launch.ts";

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

  it("仅 fx 面板注入 HERDR_PANE_ID（非 fx 不伪造 Herdr 归属）", () => {
    const fx = withPanelStatusEnv(
      undefined,
      "terminal-1",
      "7",
      hookEnv,
      undefined,
      "fx"
    );
    expect(fx.env?.HERDR_PANE_ID).toBe("terminal-1");
    const plain = withPanelStatusEnv(undefined, "terminal-1", "7", hookEnv);
    expect(plain.env?.HERDR_PANE_ID).toBeUndefined();
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
    expect(out.env).toEqual({
      PIER_PANEL_ID: "panel-3",
      PIER_WINDOW_ID: "7",
    });
  });

  it("剥离父级历史 PIER_AGENT_CALLER_* 且不重新注入", () => {
    const out = withPanelStatusEnv(
      {
        command: "claude",
        env: {
          FOO: "1",
          PIER_AGENT_CALLER_BINDING: "bind_parent",
          PIER_AGENT_CALLER_CREDENTIAL_FILE: "/parent/cred.json",
        },
      },
      "panel-4",
      "9",
      hookEnv
    );
    expect(out.env?.FOO).toBe("1");
    expect(out.env?.PIER_AGENT_CALLER_BINDING).toBeUndefined();
    expect(out.env?.PIER_AGENT_CALLER_CREDENTIAL_FILE).toBeUndefined();
    expect(out.env?.PIER_PANEL_ID).toBe("panel-4");
  });

  it("剥离 dump/宿主的 TERM 等模拟器键，交给 Ghostty 自设", () => {
    const out = withPanelStatusEnv(
      {
        cwd: "/tmp/pier.worktrees/wt-1",
        env: {
          COLORTERM: "truecolor",
          COLUMNS: "80",
          LINES: "24",
          PATH: "/opt/homebrew/bin:/usr/bin",
          TERM: "dumb",
          TERMCAP: "xterm:",
          TERMINFO: "/usr/share/terminfo",
          TERMINFO_DIRS: "/usr/share/terminfo",
          TERM_PROGRAM: "iTerm.app",
          TERM_PROGRAM_VERSION: "3.5.0",
          TERM_SESSION_ID: "w0t0p0:fake",
        },
      },
      "panel-wt",
      "3",
      hookEnv
    );
    expect(out.env?.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(out.env?.TERM).toBeUndefined();
    expect(out.env?.COLORTERM).toBeUndefined();
    expect(out.env?.TERM_PROGRAM).toBeUndefined();
    expect(out.env?.TERM_PROGRAM_VERSION).toBeUndefined();
    expect(out.env?.TERM_SESSION_ID).toBeUndefined();
    expect(out.env?.TERMINFO).toBeUndefined();
    expect(out.env?.TERMINFO_DIRS).toBeUndefined();
    expect(out.env?.TERMCAP).toBeUndefined();
    expect(out.env?.COLUMNS).toBeUndefined();
    expect(out.env?.LINES).toBeUndefined();
    expect(out.env?.PIER_PANEL_ID).toBe("panel-wt");
    expect(out.env?.PIER_WINDOW_ID).toBe("3");
  });

  it("strips host NO_COLOR / FORCE_COLOR=0 so Ghostty TUIs keep color", () => {
    const out = withPanelStatusEnv(
      {
        cwd: "/tmp/wt",
        env: {
          CLICOLOR: "0",
          CLICOLOR_FORCE: "0",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          NODE_DISABLE_COLORS: "1",
          PATH: "/usr/bin",
        },
      },
      "panel-color",
      "4",
      hookEnv
    );
    expect(out.env?.PATH).toBe("/usr/bin");
    expect(out.env?.NO_COLOR).toBeUndefined();
    expect(out.env?.NODE_DISABLE_COLORS).toBeUndefined();
    expect(out.env?.FORCE_COLOR).toBeUndefined();
    expect(out.env?.CLICOLOR).toBeUndefined();
    expect(out.env?.CLICOLOR_FORCE).toBeUndefined();
  });

  it("keeps FORCE_COLOR=1 when the user explicitly wants color", () => {
    const out = withPanelStatusEnv(
      {
        env: { FORCE_COLOR: "1", PATH: "/usr/bin" },
      },
      "panel-force",
      "5",
      hookEnv
    );
    expect(out.env?.FORCE_COLOR).toBe("1");
  });

  it("writes PIER_CONTROL_SOCKET only when a path is provided", () => {
    const withSocket = withPanelStatusEnv(
      undefined,
      "panel-sock",
      "2",
      {},
      "/tmp/pier-control.sock"
    );
    expect(withSocket.env?.PIER_CONTROL_SOCKET).toBe("/tmp/pier-control.sock");
    const without = withPanelStatusEnv(undefined, "panel-sock", "2", {});
    expect(without.env?.PIER_CONTROL_SOCKET).toBeUndefined();
  });
});
