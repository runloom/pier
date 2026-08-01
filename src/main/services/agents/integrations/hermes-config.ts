const PLUGIN_NAME = "pier-status";
const TOP_LEVEL_PLUGINS_KEY_RE = /^plugins:\s*$/m;
const PLUGINS_KEY_LINE_RE = /^plugins:\s*$/;
const NON_INDENTED_LINE_RE = /^\S/;
const ENABLED_BLOCK_KEY_RE = /^ {2}enabled:\s*$/;
const ENABLED_INLINE_KEY_RE = /^ {2}enabled:\s*\S.*$/;
const ENABLED_LIST_ITEM_RE = /^( {4}- )(.+)$/;
const PLUGINS_SIBLING_KEY_RE = /^ {2}\S/;
const TRAILING_NEWLINE_RE = /\n$/;

interface PluginsBlockLocation {
  /** enabled 子块最后一行（不包含后续 plugins 同级键）。 */
  enabledEndLine: number | null;
  /** true 表示 enabled 存在但不是受支持的块列表形式。 */
  enabledIsMalformed: boolean;
  enabledLine: number | null;
  /** `plugins:` 后到下一个非缩进顶层键（或文件结尾）的范围。 */
  endLine: number;
  startLine: number;
}

function findPluginsBlock(lines: string[]): PluginsBlockLocation | null {
  const startLine = lines.findIndex((line) => PLUGINS_KEY_LINE_RE.test(line));
  if (startLine === -1) {
    return null;
  }
  let endLine = lines.length - 1;
  for (let index = startLine + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.length > 0 && NON_INDENTED_LINE_RE.test(line)) {
      endLine = index - 1;
      break;
    }
  }
  let enabledLine: number | null = null;
  let enabledEndLine: number | null = null;
  let enabledIsMalformed = false;
  for (let index = startLine + 1; index <= endLine; index++) {
    const line = lines[index] ?? "";
    if (ENABLED_BLOCK_KEY_RE.test(line)) {
      enabledLine = index;
      enabledEndLine = endLine;
      for (let childIndex = index + 1; childIndex <= endLine; childIndex++) {
        if (PLUGINS_SIBLING_KEY_RE.test(lines[childIndex] ?? "")) {
          enabledEndLine = childIndex - 1;
          break;
        }
      }
      break;
    }
    if (ENABLED_INLINE_KEY_RE.test(line)) {
      enabledLine = index;
      enabledIsMalformed = true;
      break;
    }
  }
  return {
    enabledEndLine,
    enabledIsMalformed,
    enabledLine,
    endLine,
    startLine,
  };
}

/**
 * 保守文本插入：只接受 `plugins.enabled` 的块列表形式；无法识别时返回
 * null，由调用方放弃写入，避免破坏用户 YAML。
 */
export function withHermesPluginEnabled(raw: string): string | null {
  if (raw.trim().length === 0) {
    return `plugins:\n  enabled:\n    - ${PLUGIN_NAME}\n`;
  }
  const hasTrailingNewline = raw.endsWith("\n");
  const lines = raw.replace(TRAILING_NEWLINE_RE, "").split("\n");
  const block = findPluginsBlock(lines);
  if (!block) {
    const separator = hasTrailingNewline ? "" : "\n";
    return `${raw}${separator}plugins:\n  enabled:\n    - ${PLUGIN_NAME}\n`;
  }
  if (block.enabledLine === null) {
    const insertAt = block.startLine + 1;
    const next = [
      ...lines.slice(0, insertAt),
      "  enabled:",
      `    - ${PLUGIN_NAME}`,
      ...lines.slice(insertAt),
    ];
    return `${next.join("\n")}\n`;
  }
  if (block.enabledIsMalformed) {
    return null;
  }
  let listEnd = block.enabledLine;
  const items: string[] = [];
  for (
    let index = block.enabledLine + 1;
    index <= (block.enabledEndLine ?? block.enabledLine);
    index++
  ) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      listEnd = index;
      continue;
    }
    const captured = line.match(ENABLED_LIST_ITEM_RE)?.[2];
    if (captured === undefined) {
      return null;
    }
    items.push(captured.trim());
    listEnd = index;
  }
  if (items.includes(PLUGIN_NAME)) {
    return raw;
  }
  const next = [
    ...lines.slice(0, listEnd + 1),
    `    - ${PLUGIN_NAME}`,
    ...lines.slice(listEnd + 1),
  ];
  return `${next.join("\n")}\n`;
}

/**
 * 只移除 Pier 插件条目；若其独占 enabled 块，同时移除空的 enabled 键。
 */
export function withoutHermesPluginEnabled(raw: string): string {
  if (raw.trim().length === 0) {
    return raw;
  }
  const hasTrailingNewline = raw.endsWith("\n");
  const lines = raw.replace(TRAILING_NEWLINE_RE, "").split("\n");
  const block = findPluginsBlock(lines);
  if (
    !block ||
    block.enabledLine === null ||
    block.enabledIsMalformed ||
    block.enabledEndLine === null
  ) {
    return raw;
  }
  const enabledLine = block.enabledLine;
  const targetLine = `    - ${PLUGIN_NAME}`;
  let index = -1;
  for (
    let candidate = enabledLine + 1;
    candidate <= block.enabledEndLine;
    candidate++
  ) {
    const line = lines[candidate] ?? "";
    if (line.trim().length > 0 && !ENABLED_LIST_ITEM_RE.test(line)) {
      return raw;
    }
    if (line === targetLine) {
      index = candidate;
    }
  }
  if (index === -1) {
    return raw;
  }
  const otherItems = lines
    .slice(enabledLine + 1, block.enabledEndLine + 1)
    .some((line, offset) => {
      const lineIndex = enabledLine + 1 + offset;
      return lineIndex !== index && ENABLED_LIST_ITEM_RE.test(line);
    });
  const removeStart = otherItems ? index : enabledLine;
  const next = [...lines.slice(0, removeStart), ...lines.slice(index + 1)];
  const joined = next.join("\n");
  return hasTrailingNewline ? `${joined}\n` : joined;
}

export function hasTopLevelHermesPluginsKey(raw: string): boolean {
  return TOP_LEVEL_PLUGINS_KEY_RE.test(raw);
}
