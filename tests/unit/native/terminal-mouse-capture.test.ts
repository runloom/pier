import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TERMINAL_SCROLL_CONTAINER_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/TerminalScrollContainer.swift"
);

function readTerminalScrollContainerSource(): string {
  return readFileSync(TERMINAL_SCROLL_CONTAINER_PATH, "utf8");
}

function swiftMethodBody(source: string, name: string): string {
  const match = source.match(
    new RegExp(
      `override func ${name}\\(with event: NSEvent\\) \\{([\\s\\S]*?)\\n    \\}`
    )
  );
  if (!match?.[1]) {
    throw new Error(`Swift method ${name}(with:) not found`);
  }
  return match[1];
}

describe("native terminal mouse capture routing", () => {
  it("keeps a terminal-origin left mouse sequence routed to Ghostty until release", () => {
    const source = readTerminalScrollContainerSource();

    expect(source).toContain("private enum TerminalMouseButton");
    expect(source).toContain(
      "private var capturedTerminalMouseButton: TerminalMouseButton?"
    );
    expect(swiftMethodBody(source, "mouseDown")).toContain(
      "capturedTerminalMouseButton = .left"
    );
    expect(swiftMethodBody(source, "mouseDragged")).toContain(
      "capturedTerminalMouseButton == .left"
    );
    expect(swiftMethodBody(source, "mouseDragged")).toContain(
      "terminalView.mouseDragged(with: event)"
    );
    expect(swiftMethodBody(source, "mouseUp")).toContain(
      "defer { capturedTerminalMouseButton = nil }"
    );
    expect(swiftMethodBody(source, "mouseUp")).toContain(
      "terminalView.mouseUp(with: event)"
    );
  });

  it("keeps terminal-origin right and other mouse sequences routed consistently", () => {
    const source = readTerminalScrollContainerSource();

    expect(swiftMethodBody(source, "rightMouseDown")).toContain(
      "capturedTerminalMouseButton = .right"
    );
    expect(swiftMethodBody(source, "rightMouseDragged")).toContain(
      "capturedTerminalMouseButton == .right"
    );
    expect(swiftMethodBody(source, "rightMouseDragged")).toContain(
      "terminalView.rightMouseDragged(with: event)"
    );
    expect(swiftMethodBody(source, "rightMouseUp")).toContain(
      "defer { capturedTerminalMouseButton = nil }"
    );
    expect(swiftMethodBody(source, "rightMouseUp")).toContain(
      "terminalView.rightMouseUp(with: event)"
    );
    expect(swiftMethodBody(source, "otherMouseDown")).toContain(
      "capturedTerminalMouseButton = .other"
    );
    expect(swiftMethodBody(source, "otherMouseDragged")).toContain(
      "capturedTerminalMouseButton == .other"
    );
    expect(swiftMethodBody(source, "otherMouseUp")).toContain(
      "defer { capturedTerminalMouseButton = nil }"
    );
  });
});
