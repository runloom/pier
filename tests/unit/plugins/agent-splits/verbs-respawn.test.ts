import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionMap } from "../../../../packages/plugin-agent-splits/src/main/session-map.ts";
import { isRecord } from "../../../../packages/plugin-agent-splits/src/tmux/types.ts";
import { shellInvokedCommand } from "../../../../packages/plugin-agent-splits/src/tmux/verb-context.ts";
import { runTmux } from "../../../../packages/plugin-agent-splits/src/tmux/verbs.ts";
import {
  findCommand,
  makeWorkDir,
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

describe("tmux respawn-pane mapping", () => {
  it("maps respawn-pane -k -t to terminal.open reuse without a new split", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env, sessionId } = seedSession(workDir);
    const result = await runTmux(
      [
        "respawn-pane",
        "-k",
        "-t",
        "%1",
        "-c",
        "/tmp/cwd",
        "claude",
        "--teammate",
      ],
      { env, invoke: okInvoke() }
    );
    expect(result.exitCode).toBe(0);
    const open = findCommand(result.commands, "terminal.open");
    expect(open).toMatchObject({
      focus: false,
      panelId: PANE_ONE_PANEL,
      type: "terminal.open",
      windowId: WINDOW_ID,
    });
    expect(open?.referencePanelId).toBeUndefined();
    expect(open?.placement).toBeUndefined();
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe(shellInvokedCommand(["claude", "--teammate"]));
    expect(launch.cwd).toBe("/tmp/cwd");
    const childEnv = isRecord(launch.env) ? launch.env : {};
    expect(childEnv.TMUX_PANE).toBe("%1");
    expect(childEnv.TMUX).toBe(env.TMUX);
    expect(childEnv.PIER_PANEL_ID).toBeUndefined();
    expect(String(childEnv.PATH).split(delimiter)[0]).toBe(
      join(workDir, "bin")
    );
    const map = loadSessionMap(workDir, sessionId);
    expect(map?.panes["%1"]?.panelId).toBe(PANE_ONE_PANEL);
    expect(Object.keys(map?.panes ?? {})).toEqual(["%0", "%1"]);
  });

  it("accepts the respawnp alias and glued -kt%1", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["respawnp", "-kt%1", "claude"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(0);
    expect(findCommand(result.commands, "terminal.open")).toMatchObject({
      panelId: PANE_ONE_PANEL,
      type: "terminal.open",
    });
  });

  it("exits 1 without -k instead of allocating a new pane", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["respawn-pane", "-t", "%1", "claude"], {
      env,
      invoke: okInvoke(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/use -k/u);
    expect(findCommand(result.commands, "terminal.open")).toBeUndefined();
  });

  it("wraps shell expressions and keeps -e env off the identity keys", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(
      [
        "respawn-pane",
        "-k",
        "-t",
        "%1",
        "-e",
        "CLAUDECODE=1",
        "-e",
        "TMUX=ignore",
        "--",
        "cd /tmp && env CLAUDECODE=1 claude --teammate",
      ],
      {
        env: { ...env, PATH: "/usr/bin" },
        invoke: okInvoke(),
      }
    );
    expect(result.exitCode).toBe(0);
    const open = findCommand(result.commands, "terminal.open");
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe(
      shellInvokedCommand(["cd /tmp && env CLAUDECODE=1 claude --teammate"])
    );
    const childEnv = isRecord(launch.env) ? launch.env : {};
    expect(childEnv.CLAUDECODE).toBe("1");
    expect(childEnv.TMUX).toBe(env.TMUX);
    expect(String(childEnv.PATH).split(delimiter)).toEqual([
      join(workDir, "bin"),
      "/usr/bin",
    ]);
  });

  it("does not double-wrap an already shell-invoked command", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(
      ["respawn-pane", "-k", "-t", "%1", "--", "/bin/sh -c 'echo hi'"],
      { env, invoke: okInvoke() }
    );
    expect(result.exitCode).toBe(0);
    const open = findCommand(result.commands, "terminal.open");
    const launch = isRecord(open?.launch) ? open.launch : {};
    expect(launch.command).toBe("/bin/sh -c 'echo hi'");
  });
});
