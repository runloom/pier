import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isRecord,
  type JsonCommand,
} from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";
import { shellInvokedCommand } from "../../../../packages/plugin-agent-splits/src/tmux/verb-context.ts";
import { runTmux } from "../../../../packages/plugin-agent-splits/src/tmux/verbs.ts";
import {
  findCommand,
  LEADER_PANEL,
  makeWorkDir,
  OPENED_PANEL,
  okInvoke,
  PANE_ONE_PANEL,
  removeWorkDir,
  seedSession,
  WINDOW_ID,
} from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

describe("tmux split-window mapping", () => {
  it("maps split-window -t %1 -v -d -P -F to terminal.open with reference and no focus", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(
      ["split-window", "-t", "%1", "-v", "-d", "-P", "-F", "#{pane_id}"],
      { env, invoke: okInvoke() }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%2\n");
    const open = findCommand(result.commands, "terminal.open");
    expect(open).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: PANE_ONE_PANEL,
      type: "terminal.open",
      windowId: WINDOW_ID,
    });
    const launch = isRecord(open?.launch) ? open.launch : {};
    const childEnv = isRecord(launch.env) ? launch.env : {};
    expect(childEnv.TMUX_PANE).toBe("%2");
    expect(childEnv.TMUX).toBe(env.TMUX);
    expect(childEnv.PIER_CONTROL_SOCKET).toBe(env.PIER_CONTROL_SOCKET);
    expect(childEnv.PIER_WINDOW_ID).toBe(WINDOW_ID);
    expect(childEnv.PIER_PANEL_ID).toBeUndefined();
  });

  it("does not set focus false when -d is omitted", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["split-window", "-t", "%0", "-v"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(0);
    const open = findCommand(result.commands, "terminal.open");
    expect(open?.focus).not.toBe(false);
    expect(open?.focus).toBe(true);
    expect(open?.referencePanelId).toBe(LEADER_PANEL);
    expect(open?.placement).toBe("split-below");
  });

  it("maps -h to split-right and new-window to active-tab", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const split = await runTmux(["splitw", "-h", "-c", "/tmp/cwd"], {
      env,
      invoke: okInvoke(),
    });
    const splitOpen = findCommand(split.commands, "terminal.open");
    expect(splitOpen?.placement).toBe("split-right");
    const launch = isRecord(splitOpen?.launch) ? splitOpen.launch : {};
    expect(launch.cwd).toBe("/tmp/cwd");

    const created = await runTmux(["new-window"], {
      env,
      invoke: okInvoke(),
    });
    const tabOpen = findCommand(created.commands, "terminal.open");
    expect(tabOpen?.placement).toBe("active-tab");
    expect(tabOpen?.referencePanelId).toBe(LEADER_PANEL);
    expect(created.exitCode).toBe(0);

    const envWithoutPane = {
      PIER_CONTROL_SOCKET: env.PIER_CONTROL_SOCKET,
      PIER_PANEL_ID: env.PIER_PANEL_ID,
      PIER_WINDOW_ID: env.PIER_WINDOW_ID,
      TMUX: env.TMUX,
    };
    const pinned = await runTmux(["new-window"], {
      env: envWithoutPane,
      invoke: okInvoke(),
    });
    expect(
      findCommand(pinned.commands, "terminal.open")?.referencePanelId
    ).toBe(LEADER_PANEL);

    const targeted = await runTmux(["new-window", "-t", "%1"], {
      env,
      invoke: okInvoke(),
    });
    expect(
      findCommand(targeted.commands, "terminal.open")?.referencePanelId
    ).toBe(PANE_ONE_PANEL);
  });

  it("equalizes remaining panes on the killed split's axis", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    const right = await runTmux(["split-window", "-t", "%0", "-h", "-d"], {
      env,
      invoke: okInvoke(),
    });
    expect(right.exitCode).toBe(0);
    const below = await runTmux(["split-window", "-t", "%1", "-v", "-d"], {
      env,
      invoke: okInvoke(),
    });
    expect(below.exitCode).toBe(0);
    const killedBelow = await runTmux(["kill-pane", "-t", "%2"], {
      env,
      invoke: okInvoke(),
    });
    expect(findCommand(killedBelow.commands, "panel.equalize")).toMatchObject({
      axis: "vertical",
      type: "panel.equalize",
    });
  });

  it("equalizes horizontally after killing a -h pane that still has siblings", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    expect(
      (
        await runTmux(["split-window", "-t", "%0", "-h", "-d"], {
          env,
          invoke: okInvoke(),
        })
      ).exitCode
    ).toBe(0);
    expect(
      (
        await runTmux(["split-window", "-t", "%0", "-h", "-d"], {
          env,
          invoke: okInvoke(),
        })
      ).exitCode
    ).toBe(0);
    const killed = await runTmux(["kill-pane", "-t", "%2"], {
      env,
      invoke: okInvoke(),
    });
    expect(findCommand(killed.commands, "panel.equalize")).toMatchObject({
      axis: "horizontal",
      type: "panel.equalize",
    });
  });

  it("does not equalize after killing the last split sibling", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    expect(
      (
        await runTmux(["split-window", "-t", "%0", "-h", "-d"], {
          env,
          invoke: okInvoke(),
        })
      ).exitCode
    ).toBe(0);
    const killed = await runTmux(["kill-pane", "-t", "%1"], {
      env,
      invoke: okInvoke(),
    });
    expect(killed.exitCode).toBe(0);
    expect(findCommand(killed.commands, "panel.equalize")).toBeUndefined();
  });

  it("maps send-keys literals to terminal.send and Enter to terminal.key", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["send-keys", "-t", "%0", "hello", "Enter"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(0);
    expect(findCommand(result.commands, "terminal.send")).toMatchObject({
      panelId: LEADER_PANEL,
      text: "hello",
      type: "terminal.send",
      windowId: WINDOW_ID,
    });
    expect(findCommand(result.commands, "terminal.key")).toMatchObject({
      key: "enter",
      panelId: LEADER_PANEL,
      type: "terminal.key",
    });
  });

  it("maps send-keys -l to literal text instead of eating the payload", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(
      ["send-keys", "-t", "%0", "-l", "Enter", "hello"],
      { env, invoke: okInvoke() }
    );
    expect(result.exitCode).toBe(0);
    expect(findCommand(result.commands, "terminal.send")).toMatchObject({
      panelId: LEADER_PANEL,
      text: "Enterhello",
      type: "terminal.send",
    });
    expect(findCommand(result.commands, "terminal.key")).toBeUndefined();
  });

  it("prints capture-pane -ep and still uses -S for transcript read", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const printed = await runTmux(["capture-pane", "-ep", "-t", "%1"], {
      env,
      invoke: okInvoke(),
    });
    expect(printed.exitCode).toBe(0);
    expect(printed.stdout).toBe("viewport text\n");
    expect(findCommand(printed.commands, "terminal.screen")).toMatchObject({
      panelId: PANE_ONE_PANEL,
      type: "terminal.screen",
    });

    const fromScrollback = await runTmux(
      ["capture-pane", "-p", "-S", "-", "-t", "%1"],
      { env, invoke: okInvoke() }
    );
    expect(fromScrollback.exitCode).toBe(0);
    expect(findCommand(fromScrollback.commands, "terminal.read")).toMatchObject(
      {
        panelId: PANE_ONE_PANEL,
        type: "terminal.read",
      }
    );
  });

  it("parses glued -t%1 and -vd clusters onto the target pane without focus", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const glued = await runTmux(["split-window", "-t%1", "-v", "-d"], {
      env,
      invoke: okInvoke(),
    });
    expect(glued.exitCode).toBe(0);
    expect(findCommand(glued.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: PANE_ONE_PANEL,
      type: "terminal.open",
    });

    const clustered = await runTmux(["split-window", "-vt%1", "-d"], {
      env,
      invoke: okInvoke(),
    });
    expect(clustered.exitCode).toBe(0);
    expect(findCommand(clustered.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: PANE_ONE_PANEL,
      type: "terminal.open",
    });
  });

  it("parses glued -x30% onto panel.setSize", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["resize-pane", "-t%1", "-x30%"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(0);
    expect(findCommand(result.commands, "panel.setSize")).toMatchObject({
      panelId: PANE_ONE_PANEL,
      type: "panel.setSize",
      widthRatio: 0.3,
    });
  });

  it("keeps -P -F after unglued -l 70% and sizes the new pane", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    const result = await runTmux(
      [
        "split-window",
        "-t",
        "%0",
        "-h",
        "-d",
        "-l",
        "70%",
        "-P",
        "-F",
        "#{pane_id}",
        "--",
        "cat",
      ],
      { env, invoke: okInvoke() }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n");
    const open = findCommand(result.commands, "terminal.open");
    expect(open).toMatchObject({
      focus: false,
      placement: "split-right",
      referencePanelId: LEADER_PANEL,
    });
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe(shellInvokedCommand(["cat"]));
    expect(
      String(isRecord(launch.env) ? launch.env.PATH : "").split(delimiter)[0]
    ).toBe(join(workDir, "bin"));
    expect(findCommand(result.commands, "panel.setSize")).toMatchObject({
      panelId: OPENED_PANEL,
      type: "panel.setSize",
      widthRatio: 0.7,
    });
  });

  it("still prints the new pane id when optional -l setSize fails", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    const base = okInvoke();
    const invoke = async (command: JsonCommand) => {
      if (command.type === "panel.setSize") {
        return {
          error: { code: "panel.setSize", message: "size failed" },
          ok: false as const,
          requestId: "r",
        };
      }
      return await base(command);
    };
    const result = await runTmux(
      [
        "split-window",
        "-t",
        "%0",
        "-h",
        "-d",
        "-l",
        "70%",
        "-P",
        "-F",
        "#{pane_id}",
        "--",
        "cat",
      ],
      { cwd: "/tmp", env, invoke }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("%1\n");
    expect(findCommand(result.commands, "terminal.open")).toBeDefined();
    expect(findCommand(result.commands, "panel.setSize")).toMatchObject({
      panelId: OPENED_PANEL,
      type: "panel.setSize",
      widthRatio: 0.7,
    });
  });

  it("treats select-pane -T as a title no-op and still focuses without -T", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const titled = await runTmux(
      ["select-pane", "-T", "teammate-1", "-t", "%1"],
      { env, invoke: okInvoke() }
    );
    expect(titled.exitCode).toBe(0);
    expect(findCommand(titled.commands, "panel.focus")).toBeUndefined();

    const focused = await runTmux(["select-pane", "-t", "%1"], {
      env,
      invoke: okInvoke(),
    });
    expect(focused.exitCode).toBe(0);
    expect(findCommand(focused.commands, "panel.focus")).toMatchObject({
      focus: true,
      panelId: PANE_ONE_PANEL,
      type: "panel.focus",
      windowId: WINDOW_ID,
    });
  });
});
