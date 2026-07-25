import { getAgentCatalogEntry } from "./agent-catalog.ts";
import type { AgentKind } from "./contracts/agent.ts";
import type { AgentSessionTitleSource } from "./contracts/foreground-activity.ts";

export type { AgentSessionTitleSource } from "./contracts/foreground-activity.ts";

/** Agent 产品主标题硬上限（与 tab 密度一致；P1 写入时亦裁切到此）。 */
export const MAX_AGENT_SESSION_TITLE_LENGTH = 40;

/** OSC 仅作 tooltip 时的截断上限；不得作 primary。 */
export const MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH = 120;

export interface ResolveAgentSessionTitleInput {
  agentId: AgentKind;
  cwd?: string | null | undefined;
  projectRootPath?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
}

export interface ResolvedAgentSessionTitle {
  /** 无 sessionTitle 时的 primary（便于测试与调试） */
  placeholder: string;
  /** tab / Index 主行 / title bar */
  primary: string;
  /** Index 副行等可用的项目短名；无路径时缺席 */
  secondary?: string;
}

/**
 * POSIX basename（终端 / 项目路径在 macOS 上均为 `/` 分隔）。
 * 空串 → 空；`/` → `/`；其余取末段。
 */
export function pathBasename(path: string): string {
  if (path === "" || path === "/") {
    return path;
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function agentCatalogLabel(agentId: AgentKind): string {
  return getAgentCatalogEntry(agentId)?.label ?? agentId;
}

/** 从可选字段组装 resolver 输入（兼容 exactOptionalPropertyTypes）。 */
export function agentSessionTitleInput(args: {
  agentId: AgentKind;
  cwd?: string | null | undefined;
  projectRootPath?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
}): ResolveAgentSessionTitleInput {
  return {
    agentId: args.agentId,
    ...(args.cwd != null && args.cwd !== "" ? { cwd: args.cwd } : {}),
    ...(args.projectRootPath != null && args.projectRootPath !== ""
      ? { projectRootPath: args.projectRootPath }
      : {}),
    ...(args.sessionTitle != null && args.sessionTitle !== ""
      ? { sessionTitle: args.sessionTitle }
      : {}),
    ...(args.sessionTitleSource == null
      ? {}
      : { sessionTitleSource: args.sessionTitleSource }),
  };
}

export function agentSessionPlaceholder(
  agentId: AgentKind,
  projectRootPath?: string | null,
  cwd?: string | null
): { placeholder: string; secondary?: string } {
  const label = agentCatalogLabel(agentId);
  const root = projectRootPath?.trim() || cwd?.trim() || "";
  if (!root) {
    return { placeholder: label };
  }
  const secondary = pathBasename(root);
  if (!secondary || secondary === "/") {
    return { placeholder: label };
  }
  return {
    placeholder: `${label} · ${secondary}`,
    secondary,
  };
}

const TITLE_ELLIPSIS = "…";

/** Soft-break window when hard-capping overlong titles. */
const TITLE_SOFT_BREAK_LOOKBACK = 12;

/** Protocol / transcript wrappers that must never appear in product titles. */
const PROMPT_WRAPPER_NAMES =
  "user_query|user_message|user_prompt|human|query|system|assistant";

const PROMPT_WRAPPER_PAIR = new RegExp(
  `<(${PROMPT_WRAPPER_NAMES})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
  "i"
);

const PROMPT_WRAPPER_TAG = new RegExp(
  `<\\/?(?:${PROMPT_WRAPPER_NAMES})\\b[^>]*>`,
  "gi"
);

const TITLE_SOFT_BREAK = /[\s，。、；：,.!?;:：]/u;

/**
 * Strip agent/transcript markup so tab titles stay product-facing.
 * Prefer inner text of a known wrapper; drop leftover open/close tags.
 * Does not apply greeting filters (those belong to derive-from-prompt).
 */
export function stripAgentPromptMarkup(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Full-message fenced block → body only.
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/m.exec(text.trim());
  if (fenced?.[1] !== undefined) {
    text = fenced[1];
  }

  // Prefer first non-empty known wrapper body (e.g. <user_query>…</user_query>).
  const wrapped = PROMPT_WRAPPER_PAIR.exec(text);
  if (wrapped?.[2]?.trim()) {
    text = wrapped[2];
  }

  text = text.replace(PROMPT_WRAPPER_TAG, " ");
  text = text.replace(/\[Image\s*#?\d*\]/gi, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

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

/**
 * Agent 产品主标题唯一入口（金标准 G6）。
 * 不接收 OSC / terminalTitle——调用方不得把终端装饰标题传入。
 */
export function resolveAgentSessionTitle(
  input: ResolveAgentSessionTitleInput
): ResolvedAgentSessionTitle {
  const { placeholder, secondary } = agentSessionPlaceholder(
    input.agentId,
    input.projectRootPath,
    input.cwd
  );
  const raw = input.sessionTitle?.trim();
  // Display path also strips protocol markup so already-persisted auto titles
  // like `<user_query> …` render as product copy without a rewrite.
  const title =
    raw && !raw.includes("\n")
      ? normalizeAgentSessionTitle(stripAgentPromptMarkup(raw))
      : null;
  if (title) {
    return {
      primary: title,
      placeholder,
      ...(secondary === undefined ? {} : { secondary }),
    };
  }
  return {
    primary: placeholder,
    placeholder,
    ...(secondary === undefined ? {} : { secondary }),
  };
}

/** OSC → tooltip 用；空 / 过长则截断；含换行则丢弃。 */
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
  return `${trimmed.slice(0, MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH - 1)}…`;
}

/** 写入前规范化：trim、拒换行、硬上限（超长带省略号）；不合法返回 null。 */
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

const GREETING_ONLY =
  /^(hi|hello|hey|yo|sup|你好|您好|嗨|哈喽|在吗|在么)[!?？。.\s]*$/i;

/** 纯标点 / 符号噪声（含中文顿号间隔点等），不足以为标题。 */
const TRIVIAL_TITLE = /^[\s·•‧・\-–—_|/\\.,;:!?'"“”‘’`~()[\]{}<>@#$%^&*+=]+$/u;

/**
 * 从首条用户 prompt 派生 auto 标题。寒暄 / 空 / 纯噪声 → null（保持占位）。
 * 会剥 `<user_query>` 等 transcript 包装与图片占位，避免进 tab。
 */
export function deriveAgentSessionTitleFromPrompt(
  prompt: string | null | undefined
): string | null {
  if (!prompt) {
    return null;
  }
  const text = stripAgentPromptMarkup(prompt);
  if (!text || GREETING_ONLY.test(text) || TRIVIAL_TITLE.test(text)) {
    return null;
  }
  // 过短（单字符号已由 TRIVIAL 覆盖；此处拦无意义极短串）
  if ([...text].length < 2) {
    return null;
  }
  return normalizeAgentSessionTitle(text);
}

/**
 * 写入裁决：auto 在已有任意标题时 no-op（除非 replaceAuto）；user 可覆盖 auto；非法 title → 不应用。
 */
export function decideAgentSessionTitleWrite(input: {
  nextTitle: string;
  nextSource: AgentSessionTitleSource;
  currentTitle?: string | null;
  currentSource?: AgentSessionTitleSource | null;
  /** 允许 auto 覆盖已有 auto（小模型 refine）；永不覆盖 user。 */
  replaceAuto?: boolean;
}):
  | { apply: false }
  | { apply: true; title: string; source: AgentSessionTitleSource } {
  const title = normalizeAgentSessionTitle(input.nextTitle);
  if (!title) {
    return { apply: false };
  }
  const hasCurrent = Boolean(input.currentTitle?.trim());
  if (input.nextSource === "auto" && hasCurrent) {
    if (input.currentSource === "user") {
      return { apply: false };
    }
    if (!input.replaceAuto) {
      return { apply: false };
    }
  }
  return { apply: true, title, source: input.nextSource };
}

/** Hook metadata / stdin 侧提取 prompt 时的最大原文长度（再经 derive 裁到 40）。 */
export const MAX_PROMPT_SNIPPET_LENGTH = 512;
