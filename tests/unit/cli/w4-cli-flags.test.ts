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
    expect(r.protocol).toBe("v1");
    if (r.protocol !== "v1") {
      return;
    }
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
    expect(r.protocol).toBe("v1");
    if (r.protocol !== "v1") {
      return;
    }
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
    expect(r.protocol).toBe("v1");
    if (r.protocol !== "v1") {
      return;
    }
    expect(r.envelope.command).toMatchObject({
      type: "run.output",
      runId: "run-1",
      taskId: "build",
    });
  });

  it("parses snapshot/watch as control v2 ops", () => {
    const snap = parsePierCliArgs(["snapshot", "--json"]);
    expect(snap.protocol).toBe("v2");
    if (snap.protocol !== "v2") {
      return;
    }
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
    if (watch.protocol !== "v2") {
      return;
    }
    expect(watch.op).toBe("control.watch");
    expect(watch.params).toMatchObject({ after: 2, timeoutMs: 1000 });

    const watchStructured = parsePierCliArgs([
      "watch",
      "--after",
      "3",
      "--after-boot",
      "boot-1",
      "--after-scope",
      "global",
      "--json",
    ]);
    expect(watchStructured.protocol).toBe("v2");
    if (watchStructured.protocol !== "v2") {
      return;
    }
    expect(watchStructured.op).toBe("control.watch");
    expect(watchStructured.params).toMatchObject({
      after: { revision: 3, bootId: "boot-1", scope: "global" },
    });
  });

  it("rejects removed access.* command domain", () => {
    expect(() => parsePierCliArgs(["access", "keygen", "--json"])).toThrow(
      /unknown pier CLI command/i
    );
  });

  it("parses notifications list/get/watch/focus/mark-read (W5-S2)", () => {
    const list = parsePierCliArgs([
      "notifications",
      "list",
      "--unread",
      "--json",
    ]);
    expect(list.protocol).toBe("v1");
    if (list.protocol === "v1") {
      expect(list.envelope.command).toMatchObject({
        type: "notifications.list",
        unreadOnly: true,
      });
    }
    const get = parsePierCliArgs([
      "notifications",
      "get",
      "--id",
      "n-1",
      "--json",
    ]);
    expect(get.protocol).toBe("v1");
    if (get.protocol === "v1") {
      expect(get.envelope.command).toMatchObject({
        type: "notifications.get",
        id: "n-1",
      });
    }
    const watch = parsePierCliArgs([
      "notifications",
      "watch",
      "--after",
      "3",
      "--timeout",
      "500",
      "--json",
    ]);
    expect(watch.protocol).toBe("v1");
    if (watch.protocol === "v1") {
      expect(watch.envelope.command).toMatchObject({
        type: "notifications.watch",
        after: 3,
        timeoutMs: 500,
      });
    }
    const focus = parsePierCliArgs([
      "notifications",
      "focus",
      "--id",
      "n-1",
      "--json",
    ]);
    expect(focus.protocol).toBe("v1");
    if (focus.protocol === "v1") {
      expect(focus.envelope.command).toMatchObject({
        type: "notifications.focus",
        id: "n-1",
      });
    }
    const markAll = parsePierCliArgs([
      "notifications",
      "mark-read",
      "--all",
      "--json",
    ]);
    expect(markAll.protocol).toBe("v1");
    if (markAll.protocol === "v1") {
      expect(markAll.envelope.command).toMatchObject({
        type: "notifications.mark-read",
        all: true,
      });
    }
    expect(() =>
      parsePierCliArgs([
        "notifications",
        "mark-read",
        "--id",
        "n-1",
        "--all",
        "--json",
      ])
    ).toThrow(/either --id or --all/u);
  });
});
