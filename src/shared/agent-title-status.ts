import { AGENT_CATALOG } from "./agent-catalog.ts";
import type { AgentKind } from "./contracts/agent.ts";
import type { AgentRuntimeStatus } from "./contracts/agent-session.ts";

/**
 * 终端标题启发式 agent 状态探测（orca agent-detection 移植）。
 *
 * 仅作 hook 信号缺席时的兜底：聚合器在该 panel 有新鲜 hook 数据时
 * 必须抑制本信号（防过期标题把状态闪回）。
 */
export type AgentTitleStatus = "working" | "permission" | "idle";

const CLAUDE_IDLE_PREFIX = "✳"; // ✳ Claude Code 空闲标题前缀
const GEMINI_WORKING_PREFIX = "✦"; // ✦
const GEMINI_SILENT_WORKING_PREFIX = "⏲"; // ⏲
const GEMINI_IDLE_PREFIX = "◇"; // ◇
const GEMINI_PERMISSION_PREFIX = "✋"; // ✋
const DROID_SESSION_PREFIX = "⛬"; // ⛬ Droid 全程会话前缀 (New Session/输入内容也带此符号)
const BRAILLE_SPINNER_RE = /^[⠀-⣿]/;

/**
 * "agent 上下文"识别标记(独立于状态识别):任何已知 agent 用于表明会话
 * 仍在自己前台的稳定视觉信号——glyph prefix 或 braille spinner。用于聚合器
 * 判断"用户是否已经从 agent 退回到 shell 提示符":若新标题不含身份 token
 * 且不含任何这些 marker, 视为 shell 提示符。
 */
const AGENT_CONTEXT_PREFIXES: readonly string[] = [
  CLAUDE_IDLE_PREFIX,
  GEMINI_WORKING_PREFIX,
  GEMINI_SILENT_WORKING_PREFIX,
  GEMINI_IDLE_PREFIX,
  GEMINI_PERMISSION_PREFIX,
  DROID_SESSION_PREFIX,
];

// 非对称 lookaround：左侧排除 [\w./\\-]（路径/复合词），右侧排除 [\w-]。
const STRONG_WORKING_RE =
  /(?<![\w./\\-])(?:working|thinking|running)(?![\w-])/i;
const STRONG_IDLE_RE = /(?<![\w./\\-])(?:ready|idle|done)(?![\w-])/i;

export function detectAgentStatusFromTitle(
  title: string
): AgentTitleStatus | null {
  const t = title.trim();
  if (t.length === 0) {
    return null;
  }
  if (t.startsWith(GEMINI_PERMISSION_PREFIX)) {
    return "permission";
  }
  if (
    t.startsWith(GEMINI_WORKING_PREFIX) ||
    t.startsWith(GEMINI_SILENT_WORKING_PREFIX) ||
    BRAILLE_SPINNER_RE.test(t)
  ) {
    return "working";
  }
  if (t.startsWith(GEMINI_IDLE_PREFIX) || t.startsWith(CLAUDE_IDLE_PREFIX)) {
    return "idle";
  }
  if (STRONG_WORKING_RE.test(t)) {
    return "working";
  }
  if (STRONG_IDLE_RE.test(t)) {
    return "idle";
  }
  return null;
}

export function runtimeStatusForTitleStatus(
  s: AgentTitleStatus
): AgentRuntimeStatus {
  switch (s) {
    case "working":
      return "processing";
    case "permission":
      return "waiting";
    case "idle":
      return "ready";
    default:
      return "ready";
  }
}

/**
 * shell 自动写的 prompt OSC 形态（loomdesk agent-detect 反向过滤器移植,
 * 去 Windows 盘符两条——终端始终在 macOS）。这类标题只是 cwd/host 回显,
 * 不携带任何 agent 信号：ghostty zsh integration 的 cwd 标题（`~/...`、
 * `/...`）、oh-my-zsh 的 `user@host:~/path` 都在此列。路径里含 agent
 * 字面字符串（`.worktrees/codex/...`）也不得当身份。
 */
const PROMPT_OSC_SIGNALS: readonly RegExp[] = [
  // `@host:[~/]` — user@host:cwd 形态的 `@host:` 段。冒号后必须是 path
  // marker, 避免误伤含 SSH-style remote 的主动 OSC (`Cloning git@github.com:org/repo`)。
  /@[^\s@]+:[~/]/,
  // `:~/` 或 `:~` 结尾 — host:home 形态。
  /:~(?:\/|$)/,
  // `:/X` 字母开头绝对路径 — host:/Users 等。
  /:\/[A-Za-z]/,
  // path-like 起始 — `/` 或 `~/` 开头视为 cwd 标题。
  /^\//,
  /^~\//,
];

/** 标题是否是 shell 自动 prompt OSC（cwd/user@host 回显, 非主动 title）。 */
export function looksLikePromptOsc(title: string): boolean {
  const t = title.trim();
  return PROMPT_OSC_SIGNALS.some((signal) => signal.test(t));
}

const TOKEN_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function tokenBoundaryRe(token: string): RegExp {
  const escaped = token.replace(TOKEN_ESCAPE_RE, "\\$&");
  // 词边界排除字母数字与连字符粘连：claudette/my-aiderish/路径段均不误报。
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i");
}

interface AgentTitleMatcher {
  id: AgentKind;
  tokens: readonly RegExp[];
}

/** 目录派生的标题身份匹配器（id/label/launchCmd 首词, 模块级预编译）。 */
const AGENT_TITLE_MATCHERS: readonly AgentTitleMatcher[] = AGENT_CATALOG.map(
  (entry) => {
    const tokens = new Set<string>([entry.id, entry.label.toLowerCase()]);
    const launchWord = entry.launchCmd.split(" ")[0];
    if (launchWord) {
      tokens.add(launchWord);
    }
    return {
      id: entry.id,
      tokens: [...tokens].map(tokenBoundaryRe),
    };
  }
);

/**
 * 标题看起来仍处于 agent 上下文?——用于聚合器判断 title-source 会话
 * 是否已被用户"退回 shell"。规则:含品牌 token / 状态 glyph 前缀 / braille
 * spinner / droid 的 ⛬ 会话前缀之一即为 true。纯 shell 提示符
 * (`user@host:path%`) 全 false → 聚合器可安全清理 entry。
 */
export function titleLooksLikeAgentContext(title: string): boolean {
  const t = title.trim();
  if (t.length === 0) {
    return false;
  }
  if (AGENT_CONTEXT_PREFIXES.some((prefix) => t.startsWith(prefix))) {
    return true;
  }
  if (BRAILLE_SPINNER_RE.test(t)) {
    return true;
  }
  if (STRONG_WORKING_RE.test(t) || STRONG_IDLE_RE.test(t)) {
    return true;
  }
  return detectAgentIdFromTitle(title) !== null;
}

/** 去掉标题起始的 glyph 前缀 / braille spinner / 空白, 得到身份锚定的正文。 */
const LEADING_SIGNAL_RE = new RegExp(
  `^(?:[⠀-⣿\\s]|${AGENT_CONTEXT_PREFIXES.join("|")})+`
);

/**
 * 从终端标题识别 agent 身份（orca agent-name-token-match 思路）：
 * 让「✳ Claude Code」这类启动标题在 hook（有 ~2s 执行延迟）之前就点亮
 * 图标, 也让无 hook 机制的 agent（aider / droid 等）显示真实图标。
 *
 * 两道误报防御（cwd 路径/分支名里的品牌词不得点亮图标）：
 * 1. prompt OSC 形态（`~/...` / `/...` / `user@host:cwd`）直接判 null——
 *    ghostty prompt 标题就是 cwd, `.worktrees/codex/x` 会携带品牌词。
 * 2. 品牌 token 必须锚定在标题开头（允许 glyph/spinner 前缀）——agent 的
 *    启动标题品牌名都在开头, `pier (codex/fix-login)` 这类分支名标题不算。
 */
export function detectAgentIdFromTitle(title: string): AgentKind | null {
  const t = title.trim();
  if (t.length === 0 || looksLikePromptOsc(t)) {
    return null;
  }
  const anchored = t.replace(LEADING_SIGNAL_RE, "");
  for (const matcher of AGENT_TITLE_MATCHERS) {
    for (const re of matcher.tokens) {
      const match = anchored.match(re);
      if (match?.index === 0) {
        return matcher.id;
      }
    }
  }
  return null;
}
