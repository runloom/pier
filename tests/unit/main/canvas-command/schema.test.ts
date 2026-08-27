import { describe, expect, it } from "vitest";
import {
  canvasCommandCanonical,
  parseCanvasInstanceCommands,
} from "../../../../src/shared/contracts/canvas-command.ts";

describe("parseCanvasInstanceCommands", () => {
  it("treats a missing commands field as an empty map", () => {
    const parsed = parseCanvasInstanceCommands({ methodology: "dag" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.commands.size).toBe(0);
    }
  });

  it("indexes commands by key and keeps optional cwd", () => {
    const parsed = parseCanvasInstanceCommands({
      commands: [
        { command: "echo hello", key: "refresh" },
        { command: "make -C .", cwd: "canvasDir", key: "build" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.commands.get("refresh")).toEqual({
      command: "echo hello",
      key: "refresh",
    });
    expect(parsed.commands.get("build")?.cwd).toBe("canvasDir");
  });

  it("rejects duplicate keys, invalid keys, and overlong commands", () => {
    expect(
      parseCanvasInstanceCommands({
        commands: [
          { command: "echo a", key: "refresh" },
          { command: "echo b", key: "refresh" },
        ],
      }).ok
    ).toBe(false);
    expect(
      parseCanvasInstanceCommands({
        commands: [{ command: "echo a", key: "1refresh" }],
      }).ok
    ).toBe(false);
    expect(
      parseCanvasInstanceCommands({
        commands: [{ command: "x".repeat(8193), key: "refresh" }],
      }).ok
    ).toBe(false);
    expect(parseCanvasInstanceCommands([])).toEqual({
      message: "instance.json must be an object",
      ok: false,
    });
  });
});

describe("canvasCommandCanonical", () => {
  it("defaults cwd to projectRoot so omitted and explicit match", () => {
    expect(canvasCommandCanonical({ command: "echo hello" })).toBe(
      canvasCommandCanonical({ command: "echo hello", cwd: "projectRoot" })
    );
    expect(canvasCommandCanonical({ command: "echo hello" })).not.toBe(
      canvasCommandCanonical({ command: "echo hello", cwd: "canvasDir" })
    );
  });
});
