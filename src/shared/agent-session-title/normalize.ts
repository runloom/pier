/** 写入前规范化：trim、拒换行、硬上限（超长带省略号）。 */

import {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  TITLE_ELLIPSIS,
  TITLE_SOFT_BREAK_LOOKBACK,
} from "./constants.ts";

const TITLE_SOFT_BREAK = /[\s，。、；：,.!?;:：]/u;

function truncateAgentSessionTitle(text: string): string {
  if (text.length <= MAX_AGENT_SESSION_TITLE_LENGTH) {
    return text;
  }
  const budget = MAX_AGENT_SESSION_TITLE_LENGTH - TITLE_ELLIPSIS.length;
  let cut = text.slice(0, budget);
  const minKeep = Math.max(0, budget - TITLE_SOFT_BREAK_LOOKBACK);
  for (let index = cut.length - 1; index >= minKeep; index -= 1) {
    const ch = cut[index];
    if (ch && TITLE_SOFT_BREAK.test(ch)) {
      cut = cut.slice(0, index);
      break;
    }
  }
  cut = cut.trimEnd();
  if (cut.length < 2) {
    cut = text.slice(0, budget).trimEnd();
  }
  return `${cut}${TITLE_ELLIPSIS}`;
}

/** 不合法（空 / 含换行）返回 null；超长带省略号裁到硬上限。 */
export function normalizeAgentSessionTitle(
  raw: string | null | undefined
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return null;
  }
  if (trimmed.length > MAX_AGENT_SESSION_TITLE_LENGTH) {
    return truncateAgentSessionTitle(trimmed);
  }
  return trimmed;
}

/** OSC → tooltip 用；空 / 含换行则丢弃，过长截断。 */
export function truncateTerminalTitleForTooltip(
  terminalTitle: string | null | undefined
): string | undefined {
  const trimmed = terminalTitle?.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return;
  }
  if (trimmed.length <= MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH - 1)}${TITLE_ELLIPSIS}`;
}
