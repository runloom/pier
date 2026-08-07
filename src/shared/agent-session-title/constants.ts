/** Agent 标题链路的长度与形态常量（唯一来源）。 */

/**
 * 产品会话标题**存储**硬上限（Unicode code points）。
 *
 * 与 OSC tooltip 安全上限对齐：写入期尽量保留全文，tab 短标题与 macOS
 * 顶栏的视觉省略交给 CSS（容器宽度），不要在 normalize 时为了贴合窄 tab
 * 就丢掉后半句，否则 tooltip / 顶栏只能显示带 `…` 的残缺串。
 */
export const MAX_AGENT_SESSION_TITLE_LENGTH = 512;

/**
 * OSC 展示安全上限（码点）。落盘仍可更长；展示折叠空白后硬裁，视觉截断交给 CSS。
 * 与产品 sessionTitle 存储上限相同，避免两条链路各裁一套。
 */
export const MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH = 512;

/** Hook metadata / stdin 侧提取 promptSnippet 的最大原文长度（身份/诊断用，非标题）。 */
export const MAX_PROMPT_SNIPPET_LENGTH = 512;

export const TITLE_ELLIPSIS = "…";

/** 硬截断时向前找断点的窗口（仅触及安全上限时使用）。 */
export const TITLE_SOFT_BREAK_LOOKBACK = 12;
