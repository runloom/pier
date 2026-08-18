import { describe, expect, it } from "vitest";
import { parseTmuxArgv } from "../../../../packages/plugin-tmux/src/tmux/parse.ts";

describe("tmux argv value flags are per-verb", () => {
  it("treats send-keys -l as literal, not a value flag", () => {
    const parsed = parseTmuxArgv(["send-keys", "-t", "%1", "-l", "hello"]);
    expect(parsed).toEqual({
      flags: { "-l": true, "-t": "%1" },
      kind: "command",
      rest: ["hello"],
      verb: "send-keys",
    });
  });

  it("keeps capture-pane -ep as boolean -e and -p", () => {
    const glued = parseTmuxArgv(["capture-pane", "-ep", "-t", "%1"]);
    expect(glued).toEqual({
      flags: { "-e": true, "-p": true, "-t": "%1" },
      kind: "command",
      rest: [],
      verb: "capture-pane",
    });
    const split = parseTmuxArgv(["capture-pane", "-e", "-p", "-t", "%1"]);
    expect(split).toEqual(glued);
  });

  it("still takes split-window -l as a size value", () => {
    const parsed = parseTmuxArgv([
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
    ]);
    expect(parsed).toMatchObject({
      flags: {
        "-F": "#{pane_id}",
        "-P": true,
        "-d": true,
        "-h": true,
        "-l": "70%",
        "-t": "%0",
      },
      kind: "command",
      rest: ["cat"],
      verb: "split-window",
    });
  });

  it("joins repeated respawn-pane -e values", () => {
    const parsed = parseTmuxArgv([
      "respawnp",
      "-k",
      "-t",
      "%1",
      "-e",
      "CLAUDECODE=1",
      "-e",
      "FOO=bar",
      "--",
      "claude",
    ]);
    expect(parsed).toEqual({
      flags: {
        "-e": "CLAUDECODE=1\nFOO=bar",
        "-k": true,
        "-t": "%1",
      },
      kind: "command",
      rest: ["claude"],
      verb: "respawn-pane",
    });
  });

  it("does not let select-pane -l swallow -t", () => {
    const parsed = parseTmuxArgv(["select-pane", "-l", "-t", "%1"]);
    expect(parsed).toEqual({
      flags: { "-l": true, "-t": "%1" },
      kind: "command",
      rest: [],
      verb: "select-pane",
    });
  });

  it("keeps wait-for -S as a boolean signal", () => {
    const parsed = parseTmuxArgv(["wait-for", "-S", "ready"]);
    expect(parsed).toEqual({
      flags: { "-S": true },
      kind: "command",
      rest: ["ready"],
      verb: "wait-for",
    });
  });
});
