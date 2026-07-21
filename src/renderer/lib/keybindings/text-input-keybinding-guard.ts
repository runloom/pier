import { isTextInputElement } from "./is-text-input.ts";
import type { KeyChord } from "./types.ts";

/**
 * Text-input focus should keep ownership of character typing and Enter chords.
 * Mod+letter (Cmd+W etc.) still dispatch; Mod+Shift+Enter must not maximize
 * while a textarea/composer is focused — prefer newline.
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
  return !chord.cmdOrCtrl;
}
