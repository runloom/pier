/**
 * W0 CLI 文档命令面辅助：截取 markdown 章节，并检测「当前可用」违规命令行。
 * unit 与 Canvas protocol 契约共用，避免两套规则漂移。
 */

/** 「当前可用」中禁止的规划命令；已实现的 agents self/catalog/list/get 允许。 */
const AVAILABLE_VIOLATION_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> =
  [
    {
      id: "agents.unimplemented",
      re: /^\s*pier\s+agents\s+(invoke|start|turn|screen|wait|watch|focus|interrupt|terminate)\b/mu,
    },
    { id: "access", re: /^\s*pier\s+access\b/mu },
    { id: "snapshot", re: /^\s*pier\s+snapshot\b/mu },
    { id: "watch", re: /^\s*pier\s+watch\b/mu },
    { id: "activity", re: /^\s*pier\s+activity\b/mu },
    { id: "notifications", re: /^\s*pier\s+notifications\b/mu },
    { id: "plugins enable", re: /^\s*pier\s+plugins\s+enable\b/mu },
    { id: "plugins disable", re: /^\s*pier\s+plugins\s+disable\b/mu },
  ];

/** 从 `## heading` 截到下一个同级 `## `（不含）。heading 不含 `##` 前缀。 */
export function extractMarkdownSection(
  markdown: string,
  heading: string
): string {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing markdown section: ${marker}`);
  }
  const bodyStart = start + marker.length;
  const rest = markdown.slice(bodyStart);
  const next = rest.search(/^## /mu);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** 返回「当前可用」章节中违规命令 id 列表（去重、稳定顺序）。 */
export function collectCliDocsAvailableViolations(
  availableSection: string
): string[] {
  const violations: string[] = [];
  for (const { id, re } of AVAILABLE_VIOLATION_PATTERNS) {
    if (re.test(availableSection)) {
      violations.push(id);
    }
  }
  return violations;
}

export function statusKeywordForCommandGroup(
  status: "shipped" | "partial" | "planned" | string
): string {
  if (status === "shipped") {
    return "已实现";
  }
  if (status === "partial") {
    return "部分";
  }
  if (status === "planned") {
    return "未实现";
  }
  throw new Error(`unknown command group status: ${status}`);
}

/**
 * 在能力地图正文中定位命令组对应行（表格行或加粗组名），并检查 status 关键词。
 * `顶层` 用字面「顶层」；其余优先匹配 `**\`group\`` 或 `**group**`。
 */
export function findCommandGroupMapLine(
  mapSection: string,
  group: string
): string | null {
  const lines = mapSection.split("\n");
  const needles =
    group === "顶层"
      ? ["**顶层**", "| **顶层**", "顶层"]
      : [`**\`${group}\`**`, `**${group}**`, `\`${group}\``, group];

  for (const line of lines) {
    if (!line.includes("|")) {
      continue;
    }
    for (const needle of needles) {
      if (line.includes(needle)) {
        return line;
      }
    }
  }
  return null;
}

export function commandGroupStatusMatchesDocs(
  mapLine: string,
  status: "shipped" | "partial" | "planned" | string
): boolean {
  const keyword = statusKeywordForCommandGroup(status);
  return mapLine.includes(keyword);
}
