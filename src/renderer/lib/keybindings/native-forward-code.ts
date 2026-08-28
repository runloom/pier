/**
 * Map characters forwarded from AppKit (`charactersIgnoringModifiers`) to
 * KeyboardEvent.code names used by DEFAULT_KEYMAP.
 *
 * AppKit does not strip Shift from that string, so ⌘⇧] arrives as "}" and
 * ⌘⇧= as "+". Unshift those before the unshifted punctuation map.
 */

const SHIFTED_PUNCTUATION_CODE: Readonly<Record<string, string>> = {
  '"': "Quote",
  "+": "Equal",
  ":": "Semicolon",
  "<": "Comma",
  ">": "Period",
  "?": "Slash",
  _: "Minus",
  "{": "BracketLeft",
  "|": "Backslash",
  "}": "BracketRight",
  "~": "Backquote",
};

const LATIN_LOWER_RE = /^[a-z]$/;
const DIGIT_RE = /^[0-9]$/;

export function nativeForwardCharToCode(chars: string): string | null {
  if (chars.length !== 1) {
    return null;
  }
  return SHIFTED_PUNCTUATION_CODE[chars] ?? null;
}

export function charsToCode(chars: string): string {
  const shifted = nativeForwardCharToCode(chars);
  if (shifted) {
    return shifted;
  }
  const ch = chars.toLowerCase();
  if (LATIN_LOWER_RE.test(ch)) {
    return `Key${ch.toUpperCase()}`;
  }
  if (DIGIT_RE.test(ch)) {
    return `Digit${ch}`;
  }
  switch (ch) {
    case "`":
      return "Backquote";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    case "/":
      return "Slash";
    case ";":
      return "Semicolon";
    case "'":
      return "Quote";
    case "[":
      return "BracketLeft";
    case "]":
      return "BracketRight";
    case "\\":
      return "Backslash";
    case "-":
      return "Minus";
    case "=":
      return "Equal";
    case "\r":
      return "Enter";
    case "\u{3}":
      return "Enter";
    case "\u{F700}":
      return "ArrowUp";
    case "\u{F701}":
      return "ArrowDown";
    case "\u{F702}":
      return "ArrowLeft";
    case "\u{F703}":
      return "ArrowRight";
    case "\u{1b}":
      return "Escape";
    default:
      return ch;
  }
}
