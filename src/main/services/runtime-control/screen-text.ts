/**
 * screen 文本有界化：去控制序列、按行/字节截断。
 * 不保留 scrollback；输入应已是当前 viewport。
 */

const ANSI_RE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional CSI strip
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./gu;

export function stripControlSequences(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n");
}

export function clampScreenText(
  raw: string,
  maxLines: number,
  maxBytes: number
): { text: string; truncated: boolean; rows: number } {
  const cleaned = stripControlSequences(raw);
  const allLines = cleaned.split("\n");
  let lines = allLines;
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(lines.length - maxLines);
    truncated = true;
  }
  let text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    truncated = true;
    // 从末尾按 Unicode 码点裁剪，避免切断多字节 UTF-8
    const chars = [...text];
    let start = 0;
    while (
      start < chars.length &&
      Buffer.byteLength(chars.slice(start).join(""), "utf8") > maxBytes
    ) {
      start += 1;
    }
    text = chars.slice(start).join("");
  }
  return {
    text,
    truncated,
    rows: text.length === 0 ? 0 : text.split("\n").length,
  };
}
