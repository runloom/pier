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
  const trimmed = input.sessionTitle?.trim();
  if (
    trimmed &&
    !trimmed.includes("\n") &&
    trimmed.length <= MAX_AGENT_SESSION_TITLE_LENGTH
  ) {
    return {
      primary: trimmed,
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

/** 写入前规范化：trim、拒换行、硬上限；不合法返回 null（调用方失败安全）。 */
export function normalizeAgentSessionTitle(
  raw: string | null | undefined
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return null;
  }
  if (trimmed.length > MAX_AGENT_SESSION_TITLE_LENGTH) {
    return trimmed.slice(0, MAX_AGENT_SESSION_TITLE_LENGTH).trimEnd();
  }
  return trimmed;
}

const GREETING_ONLY =
  /^(hi|hello|hey|yo|sup|你好|您好|嗨|哈喽|在吗|在么)[!?？。.\s]*$/i;

/** 纯标点 / 符号噪声（含中文顿号间隔点等），不足以为标题。 */
const TRIVIAL_TITLE = /^[\s·•‧・\-–—_|/\\.,;:!?'"“”‘’`~()[\]{}<>@#$%^&*+=]+$/u;

/**
 * 从首条用户 prompt 派生 auto 标题。寒暄 / 空 / 纯噪声 → null（保持占位）。
 */
export function deriveAgentSessionTitleFromPrompt(
  prompt: string | null | undefined
): string | null {
  if (!prompt) {
    return null;
  }
  let text = prompt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/\[Image\s*#?\d*\]/gi, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\s+/g, " ").trim();
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
