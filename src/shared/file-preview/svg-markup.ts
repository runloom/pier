/**
 * 嗅探窗口（字节）。字节路径按字节截断；文本路径按 UTF-16 码元截断，
 * 因此含大量非 ASCII 前缀时文本路径能看到更多内容——两者都只用来看
 * 文档头部的根标签，宽窗口只会更宽松，不会误判为其它类型。
 */
export const PREVIEW_SVG_SNIFF_LIMIT_BYTES = 8192;

export function classifyPreviewSvgMarkupText(
  text: string
): "image/svg+xml" | null {
  const source =
    text.length > PREVIEW_SVG_SNIFF_LIMIT_BYTES
      ? text.slice(0, PREVIEW_SVG_SNIFF_LIMIT_BYTES)
      : text;
  return previewSvgRootStart(source) === null ? null : "image/svg+xml";
}

/**
 * Root `<svg …>` open tag after BOM / XML declaration / doctype / comments.
 * Returns null when the tag is missing or runs past the sniff window
 * (unterminated root tags still classify as SVG, but carry no readable size).
 */
export function previewSvgRootTagText(text: string): string | null {
  const source =
    text.length > PREVIEW_SVG_SNIFF_LIMIT_BYTES
      ? text.slice(0, PREVIEW_SVG_SNIFF_LIMIT_BYTES)
      : text;
  const start = previewSvgRootStart(source);
  if (start === null) {
    return null;
  }
  const end = svgTagEnd(source, start);
  return end === null ? null : source.slice(start, end + 1);
}

/** Index of the `<svg` root after BOM / XML declaration / doctype / comments, or null. */
function previewSvgRootStart(source: string): number | null {
  let index = source.startsWith("﻿") ? 1 : 0;
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
    // 只跳过注释与 doctype。浏览器对 SVG 文档只拒绝小写
    // `<!doctype html>`（走 HTML 解析路径），其余 doctype 均按 SVG 正常
    // 渲染，这里照此实现。
    if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end < 0) {
        return null;
      }
      index += end + 3;
      continue;
    }
    if (rest.startsWith("<!")) {
      if (/^<!\s*doctype\s+html\b/iu.test(rest)) {
        return null;
      }
      const end = rest.indexOf(">");
      if (end < 0) {
        return null;
      }
      index += end + 1;
      continue;
    }
    break;
  }
  skipWhitespace();
  return /^<svg\b/u.test(source.slice(index)) ? index : null;
}

function svgTagEnd(source: string, start: number): number | null {
  let quote: string | null = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        return index;
      }
    } else if (char === quote) {
      quote = null;
    }
  }
  return null;
}

export function classifyPreviewSvgMarkup(
  bytes: Uint8Array
): "image/svg+xml" | null {
  const slice =
    bytes.byteLength > PREVIEW_SVG_SNIFF_LIMIT_BYTES
      ? bytes.subarray(0, PREVIEW_SVG_SNIFF_LIMIT_BYTES)
      : bytes;
  return classifyPreviewSvgMarkupText(new TextDecoder("utf-8").decode(slice));
}
