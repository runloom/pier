/**
 * Map a UTF-8 byte offset into a JS string to a string index (UTF-16 code units).
 * Used by content-search hits → CodeMirror selection.
 */
export function utf8ByteOffsetToStringIndex(
  text: string,
  byteOffset: number
): number {
  if (byteOffset <= 0) {
    return 0;
  }
  const encoder = new TextEncoder();
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    if (bytes >= byteOffset) {
      return index;
    }
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const char = String.fromCodePoint(codePoint);
    bytes += encoder.encode(char).byteLength;
    index += char.length;
  }
  return text.length;
}
