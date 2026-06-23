import { beforeEach, describe, expect, it } from "vitest";
import { chordEquals } from "@/lib/keybindings/matcher.ts";
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

describe("keybinding engine", () => {
  beforeEach(() => {
    // registry 是 singleton — 用空 user keymap 重置后灌固定 defaults.
    keybindingRegistry.loadUserKeymap([]);
  });

  it("parses Mod+Shift+KeyP into KeyChord", () => {
    const chord = parseChord("Mod+Shift+KeyP");
    expect(chord).toEqual({
      cmdOrCtrl: true,
      alt: false,
      shift: true,
      code: "KeyP",
    });
  });

  it("rejects duplicate Mod prefix", () => {
    expect(() => parseChord("Mod+Mod+KeyP")).toThrow('duplicate "Mod"');
  });

  it("resolves registered default chord", () => {
    const keymap: readonly KeybindingInput[] = [
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ];
    keybindingRegistry.registerDefaults(keymap);
    const chord = parseChord("Mod+KeyW");
    expect(keybindingRegistry.resolve(chord, GLOBAL_SCOPE)).toBe(
      "pier.test.action"
    );
  });

  it("returns null for unregistered chord", () => {
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.action", keys: "Mod+KeyW" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ"), GLOBAL_SCOPE)
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
      keybindingRegistry.resolve(parseChord("Mod+KeyW"), GLOBAL_SCOPE)
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
      keybindingRegistry.resolve(parseChord("Mod+KeyW"), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ"), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
    // 要屏蔽 default 需用 -commandId 解绑
    keybindingRegistry.loadUserKeymap([
      { commandId: "-pier.test.action", keys: "" },
      { commandId: "pier.test.action", keys: "Mod+KeyQ" },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW"), GLOBAL_SCOPE)
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyQ"), GLOBAL_SCOPE)
    ).toBe("pier.test.action");
  });

  it("chordEquals is reflexive", () => {
    const a = parseChord("Alt+Shift+Digit1");
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
