import { afterEach, describe, expect, it } from "vitest";
import {
  runTmux,
  TMUX_VERSION_LINE,
} from "../../../../packages/plugin-tmux/src/tmux/verbs.ts";
import {
  findCommand,
  makeWorkDir,
  okInvoke,
  removeWorkDir,
  seedSession,
} from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

describe("tmux cli guards", () => {
  it("prints version locally without hitting the control socket", async () => {
    const invoke = async () => {
      throw new Error("version must not use the control socket");
    };
    for (const argv of [["-V"], ["-version"], ["version"]]) {
      const result = await runTmux(argv, { env: {}, invoke });
      expect(result).toEqual({
        commands: [],
        exitCode: 0,
        stderr: "",
        stdout: TMUX_VERSION_LINE,
      });
    }
  });

  it("exits 1 for unknown verbs and rejected config verbs", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const unknown = await runTmux(["clock-mode"], {
      env,
      invoke: okInvoke(),
    });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toMatch(/unknown command/u);
    expect(unknown.commands).toEqual([]);

    const rejected = await runTmux(["bind-key", "c", "new-window"], {
      env,
      invoke: okInvoke(),
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toMatch(/unsupported command: bind-key/u);
    expect(rejected.commands).toEqual([]);
  });

  it("treats has-session, list-sessions, and set-option as in-session probes", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const hasSession = await runTmux(["has-session"], {
      env,
      invoke: okInvoke(),
    });
    expect(hasSession).toEqual({
      commands: [],
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    const sessions = await runTmux(["list-sessions"], {
      env,
      invoke: okInvoke(),
    });
    expect(sessions.exitCode).toBe(0);
    expect(sessions.stdout).toMatch(/: 1 windows\n$/u);
    expect(sessions.commands).toEqual([]);
    const setOption = await runTmux(["set-option", "-g", "status", "off"], {
      env,
      invoke: okInvoke(),
    });
    expect(setOption.exitCode).toBe(0);
    expect(setOption.commands).toEqual([]);
    const aliases = await runTmux(["has"], {
      env,
      invoke: okInvoke(),
    });
    expect(aliases.exitCode).toBe(0);
    const listed = await runTmux(["ls"], {
      env,
      invoke: okInvoke(),
    });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toMatch(/: 1 windows\n$/u);
  });

  it("exits 1 when TMUX or PIER_CONTROL_SOCKET is missing", async () => {
    const invoke = async () => {
      throw new Error("missing session env must not hit the host");
    };
    const noTmux = await runTmux(["list-panes"], {
      env: { PIER_CONTROL_SOCKET: "/tmp/pier.sock" },
      invoke,
    });
    expect(noTmux.exitCode).toBe(1);
    expect(noTmux.commands).toEqual([]);

    const noSocket = await runTmux(["list-panes"], {
      env: { TMUX: "/tmp/sessions/win.sock,1,0" },
      invoke,
    });
    expect(noSocket.exitCode).toBe(1);
    expect(noSocket.commands).toEqual([]);
  });

  it("lists only mapped panes and never calls terminal.list", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 2);
    const result = await runTmux(["list-panes", "-F", "#{pane_id}"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%0\n%1\n");
    expect(result.stdout).not.toContain("panel-");
    expect(findCommand(result.commands, "terminal.list")).toBeUndefined();
    expect(
      result.commands.filter((command) => command.type === "terminal.get")
        .length
    ).toBeGreaterThan(0);
  });

  it("completes wait-for locally and maps layouts without moving panes", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 3);
    const signaled = await runTmux(["wait-for", "-S", "signal"], {
      env,
      invoke: okInvoke(),
    });
    expect(signaled.exitCode).toBe(0);
    expect(signaled.commands).toEqual([]);
    const wait = await runTmux(["wait-for", "signal"], {
      env,
      invoke: okInvoke(),
    });
    expect(wait.exitCode).toBe(0);
    expect(wait.commands).toEqual([]);

    const layout = await runTmux(["select-layout", "main-vertical"], {
      env,
      invoke: okInvoke(),
    });
    expect(layout.exitCode).toBe(0);
    expect(findCommand(layout.commands, "panel.setSize")).toMatchObject({
      type: "panel.setSize",
      widthRatio: 0.3,
    });
    expect(findCommand(layout.commands, "panel.equalize")).toMatchObject({
      axis: "vertical",
      type: "panel.equalize",
    });
  });
});
