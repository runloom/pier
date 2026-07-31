/**
 * Single source for editor pointer modifiers (VS Code-aligned):
 * - Definition / go-to: Cmd (mac) or Ctrl (win/linux), alone
 * - Multi-cursor: Alt alone (not Cmd/Ctrl)
 */

function isMacPlatform(): boolean {
  return navigator.platform.startsWith("Mac");
}

/** Primary go-to-definition modifier (VS Code / Zed). */
export function isFilesLspDefinitionModifier(
  event: MouseEvent | KeyboardEvent
): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  return isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/**
 * Multi-cursor click modifier (VS Code editor.multiCursorModifier: "alt").
 * Must never overlap definition modifier.
 */
export function isFilesLspMultiCursorModifier(
  event: MouseEvent | KeyboardEvent
): boolean {
  return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
}

export function filesLspEventHasNoModifiers(
  event: MouseEvent | KeyboardEvent
): boolean {
  return !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
}

/** Definition key identity for keyup matching. */
export function filesLspDefinitionModifierKey(
  event: KeyboardEvent | MouseEvent
): "Control" | "Meta" | null {
  if (!isFilesLspDefinitionModifier(event)) {
    return null;
  }
  return isMacPlatform() ? "Meta" : "Control";
}
