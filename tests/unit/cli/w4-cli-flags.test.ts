/**
 * W4 CLI 选项必须被 stripOptions 吞掉，否则会变成 unexpected positional。
 */

import { describe, expect, it } from "vitest";
import { parsePierCliArgs } from "../../../bin/pier-cli-parser.js";

describe("W4 CLI flag stripOptions (regression)", () => {
  it("parses terminal key --key", () => {
    const r = parsePierCliArgs([
      "terminal",
      "key",
      "--panel",
      "p1",
      "--key",
      "enter",
      "--json",
    ]);
    expect(r.envelope.command).toMatchObject({
      type: "terminal.key",
      panelId: "p1",
      key: "enter",
    });
  });

  it("parses worktrees remove --delete-branch", () => {
    const r = parsePierCliArgs([
      "worktrees",
      "remove",
      "--path",
      "/tmp/wt",
      "--delete-branch",
      "--json",
    ]);
    expect(r.envelope.command).toMatchObject({
      type: "worktree.remove",
      deleteBranch: true,
    });
  });

  it("parses tasks output --task", () => {
    const r = parsePierCliArgs([
      "tasks",
      "output",
      "run-1",
      "--task",
      "build",
      "--json",
    ]);
    expect(r.envelope.command).toMatchObject({
      type: "run.output",
      runId: "run-1",
      taskId: "build",
    });
  });

  it("parses snapshot/watch as control v2 ops", () => {
    const snap = parsePierCliArgs(["snapshot", "--json"]);
    expect(snap.protocol).toBe("v2");
    expect(snap.op).toBe("control.snapshot");
    const watch = parsePierCliArgs([
      "watch",
      "--after",
      "2",
      "--timeout",
      "1000",
      "--json",
    ]);
    expect(watch.protocol).toBe("v2");
    expect(watch.op).toBe("control.watch");
    expect(watch.params).toMatchObject({ after: 2, timeoutMs: 1000 });
  });
});
