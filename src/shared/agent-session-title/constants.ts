/** Agent 标题链路的长度与形态常量（唯一来源）。 */

/**
 * 产品主标题硬上限。
 *
 * 取 120 而非贴合 tab 宽度的小值：标题是尽力而为的可读性信号，宁可存全再由
 * 展示层按容器裁，也不要在写入期就丢掉用户可能需要的后半句。tab / 行内的视觉
 * 截断由 CSS 与 truncateAgentSessionTitle 负责。
 */
export const MAX_AGENT_SESSION_TITLE_LENGTH = 120;

/**
 * OSC 展示安全上限（码点）。落盘仍可更长；展示折叠空白后硬裁，视觉截断交给 CSS。
 * 高于产品 sessionTitle 上限：OSC 是终端真源，宁可多留再由 tab CSS 裁。
 */
export const MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH = 512;

/** Hook metadata / stdin 侧提取 promptSnippet 的最大原文长度（身份/诊断用，非标题）。 */
export const MAX_PROMPT_SNIPPET_LENGTH = 512;

export const TITLE_ELLIPSIS = "…";

/** 硬截断时向前找断点的窗口。 */
export const TITLE_SOFT_BREAK_LOOKBACK = 12;
