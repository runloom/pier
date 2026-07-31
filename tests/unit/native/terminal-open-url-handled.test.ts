import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CALLBACKS_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Controller/TerminalController+Callbacks.swift"
);
const CALLBACK_BRIDGE_PATH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/InMemory/TerminalCallbackBridge.swift"
);
const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Extract the body of `static func action(...) -> Bool { ... }` from the
 * vendored Ghostty runtime callbacks. Source-level so we can lock the
 * OPEN_URL handled return without a full Swift XCTest harness.
 */
function extractActionCallbackBody(source: string): string {
  const start = source.indexOf("static func action(");
  expect(start).toBeGreaterThan(-1);
  const braceStart = source.indexOf("{", start);
  expect(braceStart).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  throw new Error("unclosed action() body");
}

describe("native terminal open-url handled return", () => {
  it("forwards OPEN_URL through the vendored bridge to Pier's delegate", () => {
    const bridge = read(CALLBACK_BRIDGE_PATH);
    const ghosttyBridge = read(GHOSTTY_BRIDGE_PATH);

    expect(bridge).toContain("GHOSTTY_ACTION_OPEN_URL");
    expect(bridge).toContain("terminalDidRequestOpenURL");
    expect(ghosttyBridge).toContain("TerminalSurfaceOpenURLDelegate");
    expect(ghosttyBridge).toContain("func terminalDidRequestOpenURL");
    expect(ghosttyBridge).toContain("forwardOpenUrlCallback");
  });

  it("marks OPEN_URL as handled so Ghostty does not fall back to the system opener", () => {
    const body = extractActionCallbackBody(read(CALLBACKS_PATH));

    // Host must dispatch into the surface bridge first.
    expect(body).toContain("bridge.handleAction(action)");

    // Ghostty treats a false return as "apprt did not handle open URL action,
    // falling back to default opener". Returning true for OPEN_URL is what
    // stops the dual-open (Pier files tab + Zed/default app).
    expect(body).toMatch(/case\s+GHOSTTY_ACTION_OPEN_URL[\s\S]*?return\s+true/);

    // A bare unconditional `return false` at the end of action() is fine for
    // unhandled tags, but OPEN_URL must not fall through to it without a
    // handled branch. Guard against "always false" regressions.
    const openUrlCaseIndex = body.search(/case\s+GHOSTTY_ACTION_OPEN_URL/);
    expect(openUrlCaseIndex).toBeGreaterThan(-1);
  });
});
