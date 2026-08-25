import { afterEach, describe, expect, it } from "vitest";
import { loadSessionMap } from "../../../../packages/plugin-agent-splits/src/main/session-map.ts";
import type {
  ControlResult,
  JsonCommand,
} from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";
import { isRecord } from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";
import { shellInvokedCommand } from "../../../../packages/plugin-agent-splits/src/tmux/verb-context.ts";
import {
  runTmux,
  TMUX_VERSION_LINE,
} from "../../../../packages/plugin-agent-splits/src/tmux/verbs.ts";
import {
  findCommand,
  LEADER_PANEL,
  makeWorkDir,
  removeWorkDir,
  seedSession,
  WINDOW_ID,
} from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

function countingInvoke(): (command: JsonCommand) => Promise<ControlResult> {
  let opened = 0;
  return async (command) => {
    if (command.type === "terminal.list") {
      throw new Error("mapped pane listing must not call terminal.list");
    }
    if (command.type === "terminal.open") {
      if (typeof command.panelId === "string") {
        return {
          data: {
            panelId: command.panelId,
            windowId: String(command.windowId ?? WINDOW_ID),
          },
          ok: true,
          requestId: "r",
        };
      }
      opened += 1;
      return {
        data: {
          panelId: `panel-new-${opened}`,
          windowId: String(command.windowId ?? WINDOW_ID),
        },
        ok: true,
        requestId: "r",
      };
    }
    if (
      command.type === "terminal.screen" ||
      command.type === "terminal.read"
    ) {
      return {
        data: { text: "viewport text" },
        ok: true,
        requestId: "r",
      };
    }
    return {
      data: {
        panelId: command.panelId,
        terminal: { canonicalPath: "/repo" },
        windowId: command.windowId,
      },
      ok: true,
      requestId: "r",
    };
  };
}

describe("gold-path tmux fixtures", () => {
  it("Claude: split → send-keys → capture-pane → kill-pane", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 1);
    const invoke = countingInvoke();

    const split = await runTmux(["split-window", "-t", "%0", "-v", "-d"], {
      env,
      invoke,
    });
    expect(split.exitCode).toBe(0);
    expect(findCommand(split.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: LEADER_PANEL,
    });

    const send = await runTmux(["send-keys", "-t", "%1", "hello", "Enter"], {
      env,
      invoke,
    });
    expect(send.exitCode).toBe(0);
    expect(findCommand(send.commands, "terminal.send")).toMatchObject({
      panelId: "panel-new-1",
      text: "hello",
    });
    expect(findCommand(send.commands, "terminal.key")).toMatchObject({
      key: "enter",
      panelId: "panel-new-1",
    });

    const literal = await runTmux(["send-keys", "-t", "%1", "-l", "Enter"], {
      env,
      invoke,
    });
    expect(literal.exitCode).toBe(0);
    expect(findCommand(literal.commands, "terminal.send")).toMatchObject({
      panelId: "panel-new-1",
      text: "Enter",
    });
    expect(findCommand(literal.commands, "terminal.key")).toBeUndefined();

    const capture = await runTmux(["capture-pane", "-ep", "-t", "%1"], {
      env,
      invoke,
    });
    expect(capture.exitCode).toBe(0);
    expect(capture.stdout).toBe("viewport text\n");
    expect(findCommand(capture.commands, "terminal.screen")).toMatchObject({
      panelId: "panel-new-1",
    });

    const killed = await runTmux(["kill-pane", "-t", "%1"], {
      cwd: "/tmp",
      env,
      invoke,
    });
    expect(killed.exitCode).toBe(0);
    expect(findCommand(killed.commands, "terminal.close")).toMatchObject({
      panelId: "panel-new-1",
    });
    expect(findCommand(killed.commands, "panel.equalize")).toBeUndefined();
    const map = loadSessionMap(workDir, sessionId);
    expect(map?.panes["%1"]).toBeUndefined();
    expect(map?.panes["%0"]?.panelId).toBe(LEADER_PANEL);
  });

  it("Claude: split placeholder then respawn-pane -k keeps the same pane", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 1);
    const invoke = countingInvoke();

    const split = await runTmux(
      ["split-window", "-t", "%0", "-v", "-d", "--", "cat"],
      { cwd: "/tmp", env, invoke }
    );
    expect(split.exitCode).toBe(0);
    expect(findCommand(split.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: LEADER_PANEL,
    });

    const respawn = await runTmux(
      ["respawn-pane", "-k", "-t", "%1", "claude", "--teammate"],
      { cwd: "/tmp", env, invoke }
    );
    expect(respawn.exitCode).toBe(0);
    const open = findCommand(respawn.commands, "terminal.open");
    expect(open).toMatchObject({
      focus: false,
      panelId: "panel-new-1",
      type: "terminal.open",
    });
    expect(open?.referencePanelId).toBeUndefined();
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe(shellInvokedCommand(["claude", "--teammate"]));
    const childEnv = isRecord(launch.env) ? launch.env : {};
    expect(childEnv.TMUX_PANE).toBe("%1");
    const map = loadSessionMap(workDir, sessionId);
    expect(Object.keys(map?.panes ?? {})).toEqual(["%0", "%1"]);
    expect(map?.panes["%1"]?.panelId).toBe("panel-new-1");
  });

  it("Claude 2.1: split cat, title, layout, then respawn shell command", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir, 1);
    const invoke = countingInvoke();

    const split = await runTmux(
      [
        "split-window",
        "-t",
        "%0",
        "-v",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "--",
        "cat",
      ],
      { cwd: "/tmp", env, invoke }
    );
    expect(split.exitCode).toBe(0);
    expect(split.stdout).toBe("%1\n");

    const setOption = await runTmux(
      ["set-option", "-p", "-t", "%1", "remain-on-exit", "failed"],
      { cwd: "/tmp", env, invoke }
    );
    expect(setOption.exitCode).toBe(0);
    expect(setOption.commands).toEqual([]);

    const titled = await runTmux(
      ["select-pane", "-T", "teammate-1", "-t", "%1"],
      { cwd: "/tmp", env, invoke }
    );
    expect(titled.exitCode).toBe(0);
    expect(findCommand(titled.commands, "panel.focus")).toBeUndefined();

    const layout = await runTmux(["select-layout", "main-vertical"], {
      env,
      invoke,
    });
    expect(layout.exitCode).toBe(0);

    const respawn = await runTmux(
      [
        "respawn-pane",
        "-k",
        "-t",
        "%1",
        "--",
        "cd /tmp && env CLAUDECODE=1 claude --teammate",
      ],
      { cwd: "/tmp", env, invoke }
    );
    expect(respawn.exitCode).toBe(0);
    const open = findCommand(respawn.commands, "terminal.open");
    expect(open).toMatchObject({
      focus: false,
      panelId: "panel-new-1",
      type: "terminal.open",
    });
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe(
      shellInvokedCommand(["cd /tmp && env CLAUDECODE=1 claude --teammate"])
    );
    const map = loadSessionMap(workDir, sessionId);
    expect(map?.panes["%1"]?.panelId).toBe("panel-new-1");
  });

  it("Claude: split -h then -t %1 -v keeps the new pane on the teammate", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    const invoke = countingInvoke();

    const right = await runTmux(["split-window", "-t", "%0", "-h", "-d"], {
      env,
      invoke,
    });
    expect(right.exitCode).toBe(0);
    expect(findCommand(right.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-right",
      referencePanelId: LEADER_PANEL,
    });

    const below = await runTmux(["split-window", "-t", "%1", "-v", "-d"], {
      env,
      invoke,
    });
    expect(below.exitCode).toBe(0);
    expect(findCommand(below.commands, "terminal.open")).toMatchObject({
      focus: false,
      placement: "split-below",
      referencePanelId: "panel-new-1",
    });
  });

  it("omo: -V → split -P -F → split new pane -v → resize 30% → kill + equalize", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir, 1);
    const invoke = countingInvoke();

    const version = await runTmux(["-V"], { cwd: "/tmp", env, invoke });
    expect(version.stdout).toBe(TMUX_VERSION_LINE);
    expect(version.commands).toEqual([]);

    const first = await runTmux(
      ["split-window", "-t", "%0", "-P", "-F", "#{pane_id}"],
      { cwd: "/tmp", env, invoke }
    );
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe("%1\n");
    const firstOpen = findCommand(first.commands, "terminal.open");
    expect(firstOpen?.focus).not.toBe(false);
    expect(firstOpen?.referencePanelId).toBe(LEADER_PANEL);

    const second = await runTmux(["split-window", "-t", "%1", "-v"], {
      env,
      invoke,
    });
    expect(second.exitCode).toBe(0);
    expect(findCommand(second.commands, "terminal.open")).toMatchObject({
      placement: "split-below",
      referencePanelId: "panel-new-1",
    });

    const resized = await runTmux(["resize-pane", "-t", "%1", "-x", "30%"], {
      env,
      invoke,
    });
    expect(resized.exitCode).toBe(0);
    expect(findCommand(resized.commands, "panel.setSize")).toMatchObject({
      panelId: "panel-new-1",
      widthRatio: 0.3,
    });

    const killed = await runTmux(["kill-pane", "-t", "%2"], {
      cwd: "/tmp",
      env,
      invoke,
    });
    expect(killed.exitCode).toBe(0);
    expect(findCommand(killed.commands, "terminal.close")).toMatchObject({
      panelId: "panel-new-2",
    });
    const equalize = findCommand(killed.commands, "panel.equalize");
    expect(equalize).toMatchObject({
      axis: "vertical",
      type: "panel.equalize",
    });
    const panelIds = isRecord(equalize) ? equalize.panelIds : undefined;
    expect(panelIds).toEqual([LEADER_PANEL, "panel-new-1"]);
  });
});
