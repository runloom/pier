/**
 * KeyChord → 用户可见文本. mac 用紧凑符号 ⌘⌥⇧K, 其他平台用 Ctrl+Alt+Shift+K.
 */

import { isMac } from "./matcher.ts";
import type { KeyChord } from "./types.ts";

const CODE_LABELS: Readonly<Record<string, string>> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backquote: "`",
  Backslash: "\\",
  Backspace: "⌫",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Delete: "Del",
  Enter: "↵",
  Equal: "=",
  Escape: "Esc",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
};

function codeLabel(code: string): string {
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  return CODE_LABELS[code] ?? code;
}

export function formatChord(chord: KeyChord): string {
  const parts = formatChordParts(chord);
  return isMac() ? parts.join("") : parts.join("+");
}

export function formatChordParts(chord: KeyChord): string[] {
  const mac = isMac();
  const parts: string[] = [];
  if (chord.cmdOrCtrl) {
    parts.push(mac ? "⌘" : "Ctrl");
  }
  if (chord.ctrl) {
    // 独立 Ctrl 物理键 — mac 上显示 ⌃ 与 ⌘ 区分; non-mac 上 chord.ctrl
    // 永远 false (parseChord 归一化), 这里走不到, 保持对称写 Ctrl.
    parts.push(mac ? "⌃" : "Ctrl");
  }
  if (chord.alt) {
    parts.push(mac ? "⌥" : "Alt");
  }
  if (chord.shift) {
    parts.push(mac ? "⇧" : "Shift");
  }
  parts.push(codeLabel(chord.code));
  return parts;
}

export function stringifyChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.cmdOrCtrl) {
    parts.push("Mod");
  }
  if (chord.ctrl) {
    parts.push("Ctrl");
  }
  if (chord.alt) {
    parts.push("Alt");
  }
  if (chord.shift) {
    parts.push("Shift");
  }
  parts.push(chord.code);
  return parts.join("+");
}
