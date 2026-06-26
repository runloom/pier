import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PATH = resolve(
  import.meta.dirname,
  "../../../src/renderer/lib/keybindings/use-keybindings.ts"
);
const SOURCE = readFileSync(PATH, "utf8");
const ENTER_RETURN_RE = /return "Enter"/;

describe("renderer native keybinding forward source invariants", () => {
  it("maps native return characters to KeyboardEvent.code Enter", () => {
    expect(SOURCE).toContain('case "\\r":');
    expect(SOURCE).toContain('case "\\u{3}":');
    expect(SOURCE).toMatch(ENTER_RETURN_RE);
  });
});
