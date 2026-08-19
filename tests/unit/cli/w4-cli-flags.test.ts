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

  it("parses terminal open --reference-panel", () => {
    const r = parsePierCliArgs([
      "terminal",
      "open",
      "--split",
      "below",
      "--reference-panel",
      "teammate-1",
      "--no-focus",
      "--json",
    ]);
    expect(r.protocol).toBe("v1");
    if (r.protocol !== "v1") {
      return;
    }
    expect(r.envelope.command).toMatchObject({
      type: "terminal.open",
      placement: "split-below",
      referencePanelId: "teammate-1",
      focus: false,
    });
  });

  it("parses terminal screen / read / close", () => {
    const screen = parsePierCliArgs([
      "terminal",
      "screen",
      "--panel",
      "p1",
      "--max-lines",
      "80",
      "--json",
    ]);
    expect(screen.protocol).toBe("v1");
    if (screen.protocol === "v1") {
      expect(screen.envelope.command).toMatchObject({
        type: "terminal.screen",
        panelId: "p1",
        maxLines: 80,
      });
    }
    const read = parsePierCliArgs([
      "terminal",
      "read",
      "--panel",
      "p1",
      "--max-bytes",
      "1024",
      "--json",
    ]);
    expect(read.protocol).toBe("v1");
    if (read.protocol === "v1") {
      expect(read.envelope.command).toMatchObject({
        type: "terminal.read",
        panelId: "p1",
        maxBytes: 1024,
      });
    }
    const close = parsePierCliArgs([
      "terminal",
      "close",
      "--panel",
      "p1",
      "--json",
    ]);
    expect(close.protocol).toBe("v1");
    if (close.protocol === "v1") {
      expect(close.envelope.command).toMatchObject({
        type: "terminal.close",
        panelId: "p1",
      });
    }
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
    ).toThrow(/not both/u);
  });

  it("parses panels set-size and equalize", () => {
    const setSize = parsePierCliArgs([
      "panels",
      "set-size",
      "p1",
      "--width-ratio",
      "0.3",
      "--height-ratio",
      "0.4",
      "--json",
    ]);
    expect(setSize.protocol).toBe("v1");
    if (setSize.protocol === "v1") {
      expect(setSize.envelope.command).toMatchObject({
        heightRatio: 0.4,
        panelId: "p1",
        type: "panel.setSize",
        widthRatio: 0.3,
      });
    }
    const equalize = parsePierCliArgs([
      "panels",
      "equalize",
      "--axis",
      "horizontal",
      "--panel",
      "p1",
      "--panel",
      "p2",
      "--json",
    ]);
    expect(equalize.protocol).toBe("v1");
    if (equalize.protocol === "v1") {
      expect(equalize.envelope.command).toMatchObject({
        axis: "horizontal",
        panelIds: ["p1", "p2"],
        type: "panel.equalize",
      });
    }
  });

  it("accepts positional primary ids for terminal, notifications, and worktrees", () => {
    const screen = parsePierCliArgs(["terminal", "screen", "p1", "--json"]);
    expect(screen.protocol).toBe("v1");
    if (screen.protocol === "v1") {
      expect(screen.envelope.command).toMatchObject({
        panelId: "p1",
        type: "terminal.screen",
      });
    }
    const keyed = parsePierCliArgs([
      "terminal",
      "key",
      "p1",
      "enter",
      "--json",
    ]);
    expect(keyed.protocol).toBe("v1");
    if (keyed.protocol === "v1") {
      expect(keyed.envelope.command).toMatchObject({
        key: "enter",
        panelId: "p1",
        type: "terminal.key",
      });
    }
    const note = parsePierCliArgs(["notifications", "get", "n-1", "--json"]);
    expect(note.protocol).toBe("v1");
    if (note.protocol === "v1") {
      expect(note.envelope.command).toMatchObject({
        id: "n-1",
        type: "notifications.get",
      });
    }
    const trees = parsePierCliArgs(["worktrees", "list", "--json"], {
      cwd: "/Users/dev/repo",
    });
    expect(trees.protocol).toBe("v1");
    if (trees.protocol === "v1") {
      expect(trees.envelope.command).toMatchObject({
        path: "/Users/dev/repo",
        type: "worktree.list",
      });
    }
    expect(() =>
      parsePierCliArgs(["terminal", "screen", "p1", "--panel", "p2"])
    ).toThrow(/not both/u);
  });
});
