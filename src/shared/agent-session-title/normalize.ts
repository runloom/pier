/**
 * 写入前规范化：trim、拒换行、安全上限（仅超界时硬裁，带省略号）。
 * tab / 顶栏视觉省略由 CSS；tooltip 与 resolveLong 用同一完整存储串。
 */

import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  TITLE_ELLIPSIS,
  TITLE_SOFT_BREAK_LOOKBACK,
} from "./constants.ts";

const TITLE_SOFT_BREAK = /[\s，。、；：,.!?;:：]/u;

function truncateWithSoftBreak(text: string, maxCodePoints: number): string {
  const points = Array.from(text);
  if (points.length <= maxCodePoints) {
    return text;
  }
  const ellipsisLength = Array.from(TITLE_ELLIPSIS).length;
  const budget = maxCodePoints - ellipsisLength;
  let cutPoints = points.slice(0, budget);
  const minKeep = Math.max(0, budget - TITLE_SOFT_BREAK_LOOKBACK);
  for (let index = cutPoints.length - 1; index >= minKeep; index -= 1) {
    const ch = cutPoints[index];
    if (ch && TITLE_SOFT_BREAK.test(ch)) {
      cutPoints = cutPoints.slice(0, index);
      break;
    }
  }
  let cut = cutPoints.join("").trimEnd();
  if (Array.from(cut).length < 2) {
    cut = points.slice(0, budget).join("").trimEnd();
  }
  return `${cut}${TITLE_ELLIPSIS}`;
}

/**
 * 不合法（空 / 含换行）返回 null。
 * 仅超过安全上限时硬裁；正常长度原样保留，供 tooltip / 顶栏展示全文。
 */
export function normalizeAgentSessionTitle(
  raw: string | null | undefined
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return null;
  }
  if (Array.from(trimmed).length > MAX_AGENT_SESSION_TITLE_LENGTH) {
    return truncateWithSoftBreak(trimmed, MAX_AGENT_SESSION_TITLE_LENGTH);
  }
  return trimmed;
}

/**
 * OSC 0/2 → tab short/long / tooltip。
 * 折叠空白与换行（不整段丢弃）；仅超安全上限时硬裁。视觉截断交给 CSS。
 */
export function truncateTerminalTitleForTooltip(
  terminalTitle: string | null | undefined
): string | undefined {
  const collapsed = terminalTitle?.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return;
  }
  const points = Array.from(collapsed);
  if (points.length <= MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH) {
    return collapsed;
  }
  return truncateWithSoftBreak(
    collapsed,
    MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH
  );
}
