import { isTextInputElement } from "./is-text-input.ts";
import type { KeyChord } from "./types.ts";

/**
 * Text-input focus should keep ownership of character typing and Enter chords.
 * Mod/Ctrl/Alt chords still dispatch so layout and editor commands remain
 * available (Cmd+W, Ctrl+G go-to-line, Alt+Up move line via CodeMirror).
 * Any Enter chord (plain / Shift / Mod+Shift) stays with the field for
 * send vs newline — not for panel maximize (default is Mod+Shift+KeyM).
 */
export function shouldSuppressKeybindingForTextInput(
  chord: KeyChord,
  target: EventTarget | null
): boolean {
  if (!isTextInputElement(target)) {
    return false;
  }
  if (chord.code === "Enter") {
    return true;
  }
  return !(chord.cmdOrCtrl || chord.ctrl || chord.alt);
}
