import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(
  process.cwd(),
  "src/renderer/components/common/command-palette/index.tsx"
);

describe("command palette action invocation", () => {
  it("passes the focused panel into enabled and handler", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).toContain("invocationFromKeybindingScope()");
    expect(source).toContain("action.enabled?.(invocation)");
    expect(source).toContain("action.handler(invocation)");
  });
});
