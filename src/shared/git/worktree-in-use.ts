/**
 * Git「分支已被其他 worktree 占用」失败解析。
 * 共享层纯函数（当前仅 renderer 使用；可在 main 侧复用）。
 * 只看 message 文本；不依赖 i18n。
 *
 * 常见英文原文（Pier 默认 / macOS 常见）：
 * - fatal: 'main' is already used by worktree at '/path'
 * - fatal: 'main' is already checked out at '/path'
 * - git 退出码 128: fatal: 'main' is already used by worktree at '…'
 *
 * 限制：匹配英文 msgid。若用户安装了 gettext 本地化的 Git，
 * 文案被翻译后本解析会 miss，调用方应回退到通用错误展示。
 */

export interface GitWorktreeInUseMatch {
  branch: string;
  path: string;
}

/** 英文 msgid 线索；与 capture 同源，供 is* 与 no-path 友好提示。 */
const WORKTREE_IN_USE_HINT_RE =
  /is already (?:used by worktree|checked out) at/i;

/**
 * 捕获 branch + path。
 * 1) Git 常规单引号包裹 branch 与 path
 * 2) path 无引号时（异常/拼接）取 `at` 后至 `--` 或行尾
 * 同一条 message 里重复 fatal 时取首次匹配。
 */
const WORKTREE_IN_USE_QUOTED_RE =
  /'((?:\\'|[^'])+)' is already (?:used by worktree|checked out) at '((?:\\'|[^'])+)'/i;

const WORKTREE_IN_USE_UNQUOTED_PATH_RE =
  /'((?:\\'|[^'])+)' is already (?:used by worktree|checked out) at ([^\s'].+?)(?:\s+--|\s*$)/im;

/** 无引号 branch（极少见）：`main is already used by worktree at /path` */
const WORKTREE_IN_USE_BARE_RE =
  /(\S+) is already (?:used by worktree|checked out) at ([^\s'].+?)(?:\s+--|\s*$)/im;

export function isGitWorktreeInUseMessage(message: string): boolean {
  return WORKTREE_IN_USE_HINT_RE.test(message);
}

function cleanCapture(value: string): string {
  return value.replace(/\\'/g, "'").trim();
}

export function parseGitWorktreeInUse(
  message: string
): GitWorktreeInUseMatch | null {
  const quoted = WORKTREE_IN_USE_QUOTED_RE.exec(message);
  if (quoted?.[1] && quoted[2]) {
    const branch = cleanCapture(quoted[1]);
    const path = cleanCapture(quoted[2]);
    if (branch && path) {
      return { branch, path };
    }
  }

  const unquotedPath = WORKTREE_IN_USE_UNQUOTED_PATH_RE.exec(message);
  if (unquotedPath?.[1] && unquotedPath[2]) {
    const branch = cleanCapture(unquotedPath[1]);
    const path = cleanCapture(unquotedPath[2]);
    if (branch && path) {
      return { branch, path };
    }
  }

  const bare = WORKTREE_IN_USE_BARE_RE.exec(message);
  if (bare?.[1] && bare[2] && WORKTREE_IN_USE_HINT_RE.test(message)) {
    // bare 的 branch 可能带前缀 fatal: —— 去掉常见前缀
    let branch = cleanCapture(bare[1]);
    branch = branch
      .replace(/^fatal:/i, "")
      .replace(/^error:/i, "")
      .trim();
    // 若仍含引号残留则失败
    if (branch.startsWith("'") || branch.endsWith("'")) {
      return null;
    }
    const path = cleanCapture(bare[2]);
    if (branch && path) {
      return { branch, path };
    }
  }

  return null;
}

export function parseGitWorktreeInUseFromError(
  error: unknown
): GitWorktreeInUseMatch | null {
  const message = error instanceof Error ? error.message : String(error);
  return parseGitWorktreeInUse(message);
}

export function isGitWorktreeInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isGitWorktreeInUseMessage(message);
}
