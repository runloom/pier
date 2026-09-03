const SVG_SNIFF_LIMIT = 8192;

export function classifyPreviewSvgMarkupText(
  text: string
): "image/svg+xml" | null {
  let source =
    text.length > SVG_SNIFF_LIMIT ? text.slice(0, SVG_SNIFF_LIMIT) : text;
  if (source.startsWith("\uFEFF")) {
    source = source.slice(1);
  }
  let index = 0;
  const skipWhitespace = () => {
    while (index < source.length && /\s/u.test(source[index] ?? "")) {
      index += 1;
    }
  };
  for (;;) {
    skipWhitespace();
    const rest = source.slice(index);
    const lowered = rest.slice(0, 5).toLowerCase();
    if (lowered === "<?xml") {
      const end = rest.indexOf("?>");
      if (end < 0) {
        return null;
      }
      index += end + 2;
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end < 0) {
        return null;
      }
      index += end + 3;
      continue;
    }
    break;
  }
  skipWhitespace();
  return /^<svg\b/iu.test(source.slice(index)) ? "image/svg+xml" : null;
}

export function classifyPreviewSvgMarkup(
  bytes: Uint8Array
): "image/svg+xml" | null {
  const slice =
    bytes.byteLength > SVG_SNIFF_LIMIT
      ? bytes.subarray(0, SVG_SNIFF_LIMIT)
      : bytes;
  return classifyPreviewSvgMarkupText(new TextDecoder("utf-8").decode(slice));
}
