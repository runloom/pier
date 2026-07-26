/** Agent 标题链路的长度与形态常量（唯一来源）。 */

/** 产品主标题硬上限（与 tab 密度一致；写入时亦裁切到此）。 */
export const MAX_AGENT_SESSION_TITLE_LENGTH = 40;

/**
 * 自动标题目标长度。规则层的软目标与模型层的生成指令都用它。
 * 与硬上限分开：上限是「不许超过」，目标是「应该多长」——合一会让模型
 * 把上限当配额去填满。
 */
export const TARGET_AUTO_TITLE_LENGTH = 24;

/** OSC 仅作 tooltip 时的截断上限；不得作 primary。 */
export const MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH = 120;

/** Hook metadata / stdin 侧提取 prompt 时的最大原文长度（再经规则层裁到上限）。 */
export const MAX_PROMPT_SNIPPET_LENGTH = 512;

export const TITLE_ELLIPSIS = "…";

/** 硬截断时向前找断点的窗口。 */
export const TITLE_SOFT_BREAK_LOOKBACK = 12;

/** 规则层剥完前缀 / 语气后至少要剩这么多字符，否则放弃规则结果回退原文。 */
export const MIN_RULE_TITLE_LENGTH = 4;

/** 模型层进入提示词的 prompt 原文上限。 */
export const MAX_REFINE_PROMPT_CHARS = 400;

/** 模型层进入提示词的改动文件数上限。 */
export const MAX_REFINE_CHANGED_FILES = 8;
