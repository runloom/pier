import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACCEPTS_FIRST_MOUSE_TRUE_PATTERN =
  /override func acceptsFirstMouse\(for _:[\s\S]*?\{\s*true\s*\}/;

describe("native terminal first mouse handling", () => {
  it("lets the terminal container receive the first click when Pier is inactive", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "native/Sources/GhosttyBridge/TerminalScrollContainer.swift"
      ),
      "utf8"
    );

    expect(source).toMatch(ACCEPTS_FIRST_MOUSE_TRUE_PATTERN);
  });
});
