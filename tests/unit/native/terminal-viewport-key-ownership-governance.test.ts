import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-04-terminal-viewport-key-ownership-gold-standard.md";
const AGENTS = "AGENTS.md";
const SCROLL_VIEW =
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalScrollView.swift";
const INPUT =
  "native/Vendor/libghostty-spm/Sources/GhosttyTerminal/Platform/AppKit/AppTerminalView+Input.swift";
const BRIDGE = "native/Sources/GhosttyBridge/GhosttyBridge.swift";
const COMPOSER = "src/renderer/panel-kits/terminal/composer-passthrough.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function extractTypeBody(source: string, typeName: string): string {
  const start = source.indexOf(`class ${typeName}`);
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
  throw new Error(`unclosed ${typeName} body`);
}

function extractFunctionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
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
  throw new Error(`unclosed ${signature} body`);
}

describe("terminal viewport key ownership gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(agents).toContain("### 终端视口按键所有权 — 金标准");
    expect(agents).toContain(SPEC);
    expect(agents).toContain(
      "tests/unit/native/terminal-viewport-key-ownership-governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("FocusNotifyingScrollView");
    expect(spec).toContain("scroll_to_row");
    expect(spec).toContain("jump_to_prompt");
    expect(spec).toContain("passthroughKeyPressForKey");
    expect(spec).toContain("scroll-to-bottom");
    expect(spec).toContain("0109-keystroke-follow-skip-nav-keys");
    expect(spec).not.toContain("不是本金标准");
    expect(agents).toContain("0109-keystroke-follow-skip-nav-keys");
    expect(agents).toContain("no-keystroke");
    expect(agents).not.toContain("不是本条");
  });

  it("refuses first responder and key-view on the native scroll chrome", () => {
    const body = extractTypeBody(read(SCROLL_VIEW), "FocusNotifyingScrollView");
    expect(body).toMatch(
      /override var acceptsFirstResponder:\s*Bool\s*\{\s*false/
    );
    expect(body).toMatch(/override var canBecomeKeyView:\s*Bool\s*\{\s*false/);
  });

  it("forwards shell keys from the scroll chrome without AppKit document scroll", () => {
    const body = extractTypeBody(read(SCROLL_VIEW), "FocusNotifyingScrollView");
    const keyDown = extractFunctionBody(body, "override func keyDown(");
    expect(keyDown).toContain("keyboardTarget");
    expect(keyDown).toContain("keyDown(with:");
    expect(keyDown).not.toContain("super.keyDown");

    const keyUp = extractFunctionBody(body, "override func keyUp(");
    expect(keyUp).toContain("keyboardTarget");
    expect(keyUp).not.toContain("super.keyUp");
  });

  it("no-ops AppKit document-navigation selectors on the scroll chrome", () => {
    const body = extractTypeBody(read(SCROLL_VIEW), "FocusNotifyingScrollView");
    for (const selector of [
      "override func moveDown(",
      "override func moveUp(",
      "override func scrollLineDown(",
      "override func scrollLineUp(",
      "override func pageDown(",
      "override func pageUp(",
      "override func scrollPageDown(",
      "override func scrollPageUp(",
      "override func moveToBeginningOfDocument(",
      "override func moveToEndOfDocument(",
    ]) {
      const fn = extractFunctionBody(body, selector);
      expect(fn.trim()).toBe("");
    }
  });

  it("does not let doCommand bubble AppKit move/scroll selectors", () => {
    const body = extractFunctionBody(
      read(INPUT),
      "override open func doCommand("
    );
    expect(body).not.toContain("super.doCommand");
  });

  it("does not add Pier arrow/page scroll keybinds", () => {
    const source = read(BRIDGE);
    const start = source.indexOf(
      "nonisolated static func configureDefaultTerminalAppearance("
    );
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 1800);
    expect(body).not.toMatch(/arrow_(up|down|left|right)\s*=\s*scroll_/);
    expect(body).not.toContain("scroll_page_lines");
    expect(body).toContain(
      'builder.withCustom("keybind", "super+backspace=text:\\\\x15")'
    );
    expect(body).not.toContain("scroll-to-bottom");
    expect(body).not.toContain("no-keystroke");
  });

  it("narrows Ghostty keystroke follow in patch 0109 instead of no-keystroke", () => {
    const patch = read(
      "native/Vendor/libghostty-spm/Patches/ghostty/0109-keystroke-follow-skip-nav-keys.patch"
    );
    const readme = read(
      "native/Vendor/libghostty-spm/Patches/ghostty/README.md"
    );
    expect(readme).toContain("0109-keystroke-follow-skip-nav-keys.patch");
    expect(patch).toContain("fn keystrokeFollowsViewport");
    expect(patch).toContain(".arrow_down");
    expect(patch).toContain(".page_down");
    expect(patch).toContain("event.mods.ctrl");
    expect(patch).toContain("scrollViewport(.bottom)");
    expect(patch).toContain(
      "if (self.config.scroll_to_bottom.keystroke and keystrokeFollowsViewport(event))"
    );
  });

  it("keeps empty-draft composer arrows as TUI keypresses", () => {
    const source = read(COMPOSER);
    expect(source).toContain('case "ArrowDown"');
    expect(source).toContain("APPKIT_KEYCODE.arrowDown");
    expect(source).toContain('case "ArrowUp"');
    expect(source).toContain("APPKIT_KEYCODE.arrowUp");
  });
});
