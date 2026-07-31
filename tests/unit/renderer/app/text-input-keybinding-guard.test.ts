import { describe, expect, it } from "vitest";
import { shouldSuppressKeybindingForTextInput } from "@/lib/keybindings/text-input-guard.ts";
import type { KeyChord } from "@/lib/keybindings/types.ts";

function chord(partial: Partial<KeyChord> & Pick<KeyChord, "code">): KeyChord {
  return {
    alt: false,
    cmdOrCtrl: false,
    ctrl: false,
    shift: false,
    ...partial,
  };
}

describe("shouldSuppressKeybindingForTextInput", () => {
  it("suppresses Mod+Shift+Enter in a textarea so Enter chords stay with newline/send", () => {
    const textarea = document.createElement("textarea");
    expect(
      shouldSuppressKeybindingForTextInput(
        chord({ code: "Enter", cmdOrCtrl: true, shift: true }),
        textarea
      )
    ).toBe(true);
  });

  it("still allows Mod+letter shortcuts while typing (including maximize Mod+Shift+M)", () => {
    const textarea = document.createElement("textarea");
    expect(
      shouldSuppressKeybindingForTextInput(
        chord({ code: "KeyW", cmdOrCtrl: true }),
        textarea
      )
    ).toBe(false);
    expect(
      shouldSuppressKeybindingForTextInput(
        chord({ code: "KeyM", cmdOrCtrl: true, shift: true }),
        textarea
      )
    ).toBe(false);
  });

  it("suppresses plain letter shortcuts in text inputs", () => {
    const input = document.createElement("input");
    expect(
      shouldSuppressKeybindingForTextInput(chord({ code: "KeyT" }), input)
    ).toBe(true);
  });

  it("does not suppress Enter chords outside text inputs", () => {
    const button = document.createElement("button");
    expect(
      shouldSuppressKeybindingForTextInput(
        chord({ code: "Enter", cmdOrCtrl: true, shift: true }),
        button
      )
    ).toBe(false);
  });
});
