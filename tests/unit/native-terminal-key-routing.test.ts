import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_HANDLED_NATIVE_TERMINAL_COMMANDS } from "@shared/commands.ts";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";

const TERMINAL_APP_SHORTCUT_KEYS_RE =
  /terminalAppShortcutKeys:\s*Set<String>\s*=\s*\[([\s\S]*?)\]/;

const GHOSTTY_BRIDGE_PATH = join(
  process.cwd(),
  "native/Sources/GhosttyBridge/GhosttyBridge.swift"
);
const NATIVE_ADDON_PATH = join(process.cwd(), "native/src/addon.mm");

function readGhosttyBridgeSource(): string {
  return readFileSync(GHOSTTY_BRIDGE_PATH, "utf8");
}

function readNativeAddonSource(): string {
  return readFileSync(NATIVE_ADDON_PATH, "utf8");
}

function swiftTerminalAppShortcuts(source: string): string[] {
  const match = source.match(TERMINAL_APP_SHORTCUT_KEYS_RE);
  if (!match) {
    throw new Error("Swift terminalAppShortcutKeys allowlist not found");
  }
  const body = match[1];
  if (!body) {
    throw new Error("Swift terminalAppShortcutKeys allowlist body is empty");
  }

  return Array.from(body.matchAll(/"([^"]+)"/g))
    .flatMap((entry) => (entry[1] ? [entry[1]] : []))
    .sort();
}

describe("native terminal key routing", () => {
  it("keeps the Swift terminal-mode allowlist in sync with DEFAULT_KEYMAP", () => {
    const nativeTerminalCommandIds = new Set<string>(
      APP_HANDLED_NATIVE_TERMINAL_COMMANDS
    );
    const markedDefaultShortcuts = DEFAULT_KEYMAP.filter((binding) =>
      nativeTerminalCommandIds.has(binding.commandId)
    )
      .map((binding) => binding.keys)
      .sort();

    expect(swiftTerminalAppShortcuts(readGhosttyBridgeSource())).toEqual(
      markedDefaultShortcuts
    );
  });

  it("does not treat common terminal editing shortcuts as Pier app shortcuts", () => {
    const shortcuts = swiftTerminalAppShortcuts(readGhosttyBridgeSource());

    expect(shortcuts).not.toContain("Mod+Backspace");
    expect(shortcuts).not.toContain("Mod+Delete");
    expect(shortcuts).not.toContain("Mod+KeyK");
    expect(shortcuts).not.toContain("Mod+KeyV");
    expect(shortcuts).not.toContain("Mod+ArrowLeft");
    expect(shortcuts).not.toContain("Mod+ArrowRight");
  });

  it("adds a Ghostty-native Cmd+Backspace binding for delete-to-line-start", () => {
    expect(readGhosttyBridgeSource()).toContain(
      'builder.withCustom("keybind", "super+backspace=text:\\\\x15")'
    );
  });

  it("maps native return characters to the Enter keybinding code", () => {
    const source = readGhosttyBridgeSource();

    expect(source).toContain('case "\\r"');
    expect(source).toContain('case "\\u{3}"');
    expect(source).toContain('return "Enter"');
  });

  it("forwards only declared terminal-mode Pier shortcuts instead of all Cmd keys", () => {
    const source = readGhosttyBridgeSource();
    const allowlistCheckIndex = source.indexOf(
      "terminalAppShortcutKeys.contains(shortcutKey)"
    );
    const forwardIndex = source.indexOf(
      "EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)"
    );

    expect(source).toContain(
      "terminalAppShortcutKey(modifierFlags: mods, chars: chars)"
    );
    expect(allowlistCheckIndex).toBeGreaterThan(-1);
    expect(forwardIndex).toBeGreaterThan(allowlistCheckIndex);
  });

  it("exposes a runtime setter for customized terminal-mode Pier shortcuts", () => {
    expect(readGhosttyBridgeSource()).toContain(
      '@_cdecl("ghostty_bridge_set_app_shortcut_keys")'
    );
    expect(readNativeAddonSource()).toContain("JsSetAppShortcutKeys");
    expect(readNativeAddonSource()).toContain(
      'exports.Set("setAppShortcutKeys"'
    );
  });

  it("forwards terminal modifier state changes for tab shortcut hints", () => {
    expect(readGhosttyBridgeSource()).toContain(".flagsChanged");
    expect(readGhosttyBridgeSource()).toContain(
      "EventRouterView.forwardModifierStateCallback"
    );
    expect(readGhosttyBridgeSource()).toContain(
      '@_cdecl("ghostty_bridge_set_modifier_forward_callback")'
    );
    expect(readNativeAddonSource()).toContain(
      "ghostty_bridge_set_modifier_forward_callback"
    );
    expect(readNativeAddonSource()).toContain("setModifierForwardCallback");
  });
});
