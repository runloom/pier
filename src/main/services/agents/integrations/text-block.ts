import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../hooks-install.ts";

const TRAILING_NEWLINES_RE = /(?:\r?\n)+$/;

interface PierTextBlockSpan {
  begin: number;
  end: number;
}

interface ParsedPierTextBlocks {
  spans: PierTextBlockSpan[];
  valid: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pierBlockMarkers(agentId: AgentKind): {
  begin: string;
  end: string;
} {
  return {
    begin: `# >>> pier-agent-status:${agentId} (managed by Pier; do not edit) >>>`,
    end: `# <<< pier-agent-status:${agentId} <<<`,
  };
}

function parsePierTextBlocks(
  raw: string,
  agentId: AgentKind
): ParsedPierTextBlocks {
  const markers = pierBlockMarkers(agentId);
  const spans: PierTextBlockSpan[] = [];
  let openBegin = -1;
  const markerLine = new RegExp(
    `^[\\t ]*(${escapeRegExp(markers.begin)}|${escapeRegExp(markers.end)})[\\t ]*\\r?$`,
    "gm"
  );
  for (const match of raw.matchAll(markerLine)) {
    const marker = match[1];
    const index = match.index;
    if (marker === markers.begin) {
      if (openBegin >= 0) {
        return { spans: [], valid: false };
      }
      openBegin = index;
      continue;
    }
    if (openBegin < 0) {
      return { spans: [], valid: false };
    }
    spans.push({
      begin: openBegin,
      end: index + match[0].length,
    });
    openBegin = -1;
  }
  return { spans, valid: openBegin < 0 };
}

function warnAmbiguousMarkers(agentId: AgentKind): void {
  console.warn(
    `[agent-hooks:${agentId}] ambiguous Pier marker blocks; skip to preserve user content`
  );
}

function removeParsedBlocks(
  raw: string,
  spans: readonly PierTextBlockSpan[]
): string {
  let next = raw;
  for (const span of spans.toReversed()) {
    const tail = next.startsWith("\n", span.end)
      ? next.slice(span.end + 1)
      : next.slice(span.end);
    const head = next
      .slice(0, span.begin)
      .replace(TRAILING_NEWLINES_RE, (newlines) =>
        newlines.includes("\r\n") ? "\r\n" : "\n"
      );
    next = head === "\n" || head === "\r\n" ? tail : head + tail;
  }
  return next;
}

/** 纯函数：替换/追加 marker 块。block 不含 marker 行本身。 */
export function upsertPierTextBlock(
  raw: string,
  agentId: AgentKind,
  block: string
): string {
  const parsed = parsePierTextBlocks(raw, agentId);
  if (!parsed.valid) {
    warnAmbiguousMarkers(agentId);
    return raw;
  }
  const { begin, end } = pierBlockMarkers(agentId);
  const stripped = removeParsedBlocks(raw, parsed.spans);
  const body = `${begin}\n${block}\n${end}\n`;
  if (stripped.length === 0) {
    return body;
  }
  return `${stripped.endsWith("\n") ? stripped : `${stripped}\n`}${body}`;
}

/** 读取全部完整 Pier 文本块内 command 的最大世代；历史无世代块视为 v1。 */
export function pierTextBlockGeneration(
  raw: string,
  agentId: AgentKind
): number {
  const parsed = parsePierTextBlocks(raw, agentId);
  if (!parsed.valid) {
    warnAmbiguousMarkers(agentId);
    return Number.MAX_SAFE_INTEGER;
  }
  let max = 0;
  for (const span of parsed.spans) {
    const block = raw.slice(span.begin, span.end);
    let blockMax = 0;
    for (const match of block.matchAll(/pier-hook-gen=(\d+)/g)) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        blockMax = Math.max(blockMax, Math.floor(value));
      }
    }
    max = Math.max(max, blockMax > 0 ? blockMax : 1);
  }
  return max;
}

/** 文本块只前进更新：更高世代已落盘时保留原文。 */
export function upsertPierTextBlockUnlessNewer(
  raw: string,
  agentId: AgentKind,
  block: string
): string {
  if (pierTextBlockGeneration(raw, agentId) > PIER_HOOK_COMMAND_GENERATION) {
    return raw;
  }
  return upsertPierTextBlock(raw, agentId, block);
}

/** 移除同一 agent 的全部完整 marker 块；不明确的 marker 结构原样保留。 */
export function removePierTextBlock(raw: string, agentId: AgentKind): string {
  const parsed = parsePierTextBlocks(raw, agentId);
  if (!parsed.valid) {
    warnAmbiguousMarkers(agentId);
    return raw;
  }
  if (parsed.spans.length === 0) {
    return raw;
  }
  return removeParsedBlocks(raw, parsed.spans);
}
