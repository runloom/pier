import { beforeEach, describe, expect, it } from "vitest";
import { chordEquals, chordFromEvent } from "@/lib/keybindings/matcher.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import type {
  KeybindingInput,
  ResolveScopeState,
} from "@/lib/keybindings/types.ts";

// 默认 scope: 空 panel + 空 overlay → resolve 直接走 global 层.
const GLOBAL_SCOPE: ResolveScopeState = {
  activePanelComponent: null,
  overlayStack: [],
};

const DUPLICATE_RE = /duplicate/;

describe("keybinding engine", () => {
  beforeEach(() => {
    // registry 是 singleton — 用空 user keymap 重置后灌固定 defaults.
    keybindingRegistry.loadUserKeymap([]);
  });

  it("parses Mod+Shift+KeyP into KeyChord", () => {
    const chord = parseChord("Mod+Shift+KeyP", false);
    expect(chord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: "KeyP",
    });
  });

  it("rejects duplicate Mod prefix", () => {
    expect(() => parseChord("Mod+Mod+KeyP", false)).toThrow('duplicate "Mod"');
  });

  it("parses Ctrl+ on mac as ctrl=true / cmdOrCtrl=false", () => {
    const chord = parseChord("Ctrl+Shift+ArrowUp", true);
    expect(chord).toEqual({
      cmdOrCtrl: false,
      ctrl: true,
      alt: false,
      shift: true,
      code: "ArrowUp",
    });
  });

  it("parses Ctrl+ on non-mac as cmdOrCtrl=true / ctrl=false (Mod 等价)", () => {
    const chord = parseChord("Ctrl+Shift+ArrowUp", false);
    expect(chord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: "ArrowUp",
    });
  });

  it("rejects duplicate Ctrl/Mod prefix on non-mac", () => {
    expect(() => parseChord("Mod+Ctrl+KeyA", false)).toThrow(DUPLICATE_RE);
  });

  it("parses Mod+ unaffected by isMac (always cmdOrCtrl)", () => {
    const macChord = parseChord("Mod+KeyP", true);
    const linuxChord = parseChord("Mod+KeyP", false);
    expect(macChord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: "KeyP",
    });
    expect(linuxChord).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: "KeyP",
    });
  });

  it("parses Mod+Shift+Enter into KeyChord", () => {
    expect(parseChord("Mod+Shift+Enter", true)).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: "Enter",
    });
  });

  it("normalizes keyboard numpad Enter to the Enter keybinding code", () => {
    const event = new KeyboardEvent("keydown", {
      code: "NumpadEnter",
      metaKey: true,
      shiftKey: true,
    });

    expect(chordFromEvent(event)).toMatchObject({
      code: "Enter",
    });
  });

  it("parses Ctrl+Shift+KeyD into a mac terminal debug chord", () => {
    expect(parseChord("Ctrl+Shift+KeyD", true)).toEqual({
      cmdOrCtrl: false,
      ctrl: true,
      alt: false,
      shift: true,
      code: "KeyD",
    });
  });

  it("parses Ctrl+Shift+KeyD into a non-mac terminal debug chord", () => {
    expect(parseChord("Ctrl+Shift+KeyD", false)).toEqual({
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: true,
      code: "KeyD",
    });
  });

  it("chordEquals distinguishes ctrl from cmdOrCtrl", () => {
    const a = {
      cmdOrCtrl: true,
      ctrl: false,
      alt: false,
      shift: false,
      code: "KeyW",
    };
    const b = {
      cmdOrCtrl: false,
      ctrl: true,
      alt: false,
      shift: false,
      code: "KeyW",
    };
    expect(chordEquals(a, b)).toBe(false);
  });

  it("resolves registered default chord", () => {
    const keymap: readonly KeybindingInput[] = [
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ];
    keybindingRegistry.registerDefaults(keymap);
    const chord = parseChord("Mod+KeyW", false);
    expect(keybindingRegistry.resolve(chord, GLOBAL_SCOPE)).toBe(
      "pier.test.action"
    );
  });

  it("returns null for unregistered chord", () => {
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ", false), GLOBAL_SCOPE)
    ).toBeNull();
  });

  it("user unbind (-prefix) suppresses default", () => {
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ]);
    keybindingRegistry.loadUserKeymap([
      { commandId: "-pier.test.action", keys: "" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW", false), GLOBAL_SCOPE)
    ).toBeNull();
  });

  it("user override adds additional binding; unbind removes default", () => {
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ]);
    // user override 追加绑定, 不替换 default — 两 chord 都命中
    keybindingRegistry.loadUserKeymap([
      { commandId: "pier.test.action", keys: "Mod+KeyQ" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW", false), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ", false), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
    // 要屏蔽 default 需用 -commandId 解绑
    keybindingRegistry.loadUserKeymap([
      { commandId: "-pier.test.action", keys: "" },
      { commandId: "pier.test.action", keys: "Mod+KeyQ" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW", false), GLOBAL_SCOPE)
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ", false), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
  });

  it("chordEquals is reflexive", () => {
    const a = parseChord("Alt+Shift+Digit1", false);
    expect(chordEquals(a, a)).toBe(true);
  });

  it("registerDefaults is idempotent", () => {
    const keymap: readonly KeybindingInput[] = [
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ];
    keybindingRegistry.registerDefaults(keymap);
    keybindingRegistry.registerDefaults(keymap);
    expect(keybindingRegistry.getBindingsFor("pier.test.action")).toHaveLength(
      1
    );
  });
});
