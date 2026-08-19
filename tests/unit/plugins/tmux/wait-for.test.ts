import { afterEach, describe, expect, it } from "vitest";
import type { ControlResult } from "../../../../packages/plugin-tmux/src/tmux/types.ts";
import { runTmux } from "../../../../packages/plugin-tmux/src/tmux/verbs.ts";
import { makeWorkDir, removeWorkDir, seedSession } from "./harness.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeWorkDir));
});

async function hostMustNotRun(): Promise<ControlResult> {
  throw new Error("wait-for must not use the control socket");
}

describe("tmux wait-for", () => {
  it("signals then waits on a channel file without hitting the host", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const signaled = await runTmux(["wait-for", "-S", "ready"], {
      env,
      invoke: hostMustNotRun,
    });
    expect(signaled).toEqual({
      commands: [],
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    const waited = await runTmux(["wait-for", "ready"], {
      env,
      invoke: hostMustNotRun,
    });
    expect(waited).toEqual({
      commands: [],
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
  });

  it("unblocks a waiter when another invocation signals the channel", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const waiter = runTmux(["wait-for", "ready"], {
      env,
      invoke: hostMustNotRun,
      waitTimeoutMs: 2000,
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 40);
    });
    const signaled = await runTmux(["wait-for", "-S", "ready"], {
      env,
      invoke: hostMustNotRun,
    });
    expect(signaled.exitCode).toBe(0);
    const waited = await waiter;
    expect(waited.exitCode).toBe(0);
    expect(waited.commands).toEqual([]);
  });

  it("times out when tests bound the wait and no signal arrives", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["wait-for", "ready"], {
      env,
      invoke: hostMustNotRun,
      waitTimeoutMs: 0,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/timed out/u);
    expect(result.commands).toEqual([]);
  });

  it("rejects path-like channel names", async () => {
    const workDir = await makeWorkDir();
    dirs.push(workDir);
    const { env } = seedSession(workDir);
    const result = await runTmux(["wait-for", "../etc"], {
      env,
      invoke: hostMustNotRun,
      waitTimeoutMs: 0,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/invalid wait channel/u);
    expect(result.commands).toEqual([]);
  });
});
