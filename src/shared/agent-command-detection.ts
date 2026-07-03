import { AGENT_CATALOG } from "./agent-catalog.ts";
import type { AgentKind } from "./contracts/agent.ts";

/**
 * 命令行 → agent 身份探测（loomdesk activity-command-detection 移植）。
 *
 * 核心原则：agent pattern 只对「可执行体词元」匹配，绝不扫全命令行——
 * `echo codex`、`curl https://claude.ai/x`、路径/分支名都不产生身份。
 * 可执行体由 commandExecutableText 解析：剥 env 前缀与 wrapper（sudo/env/
 * mise 等），解析包运行器（npx/pnpm dlx/pipx run/python -m）的包名。
 */

const SHELL_PREFIX_COMMANDS = new Set([
  "command",
  "exec",
  "noglob",
  "nocorrect",
]);
const DIRECT_PACKAGE_RUNNERS = new Set(["bunx", "npx", "uvx"]);
const PYTHON_RUNNERS = new Set(["python", "python3", "py"]);
const SUDO_OPTION_VALUE_FLAGS = new Set([
  "-C",
  "--close-from",
  "-g",
  "--group",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-T",
  "--command-timeout",
  "-u",
  "--user",
]);

const WHITESPACE_RE = /\s/;
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PATH_SEPARATOR_RE = /[\\/]/;

interface WordAccumulator {
  current: string;
  escaped: boolean;
  overflow: boolean;
  quote: "'" | '"' | null;
  words: string[];
}

function flushPendingWord(acc: WordAccumulator, maxWords: number): void {
  if (acc.current.length === 0) {
    return;
  }
  acc.words.push(acc.current);
  acc.current = "";
  if (acc.words.length >= maxWords) {
    acc.overflow = true;
  }
}

function consumeWordChar(
  acc: WordAccumulator,
  char: string,
  maxWords: number
): void {
  if (acc.escaped) {
    acc.current += char;
    acc.escaped = false;
    return;
  }
  if (char === "\\") {
    acc.escaped = true;
    return;
  }
  if (acc.quote) {
    if (char === acc.quote) {
      acc.quote = null;
    } else {
      acc.current += char;
    }
    return;
  }
  if (char === "'" || char === '"') {
    acc.quote = char;
    return;
  }
  if (WHITESPACE_RE.test(char)) {
    flushPendingWord(acc, maxWords);
    return;
  }
  acc.current += char;
}

/** 引号/转义感知的前缀分词（只取前 maxWords 个词，命令行尾部无关身份）。 */
export function splitShellCommandWords(
  value: string,
  maxWords: number
): string[] {
  const acc: WordAccumulator = {
    words: [],
    current: "",
    quote: null,
    escaped: false,
    overflow: false,
  };
  for (const char of value.trim()) {
    consumeWordChar(acc, char, maxWords);
    if (acc.overflow) {
      return acc.words;
    }
  }
  if (acc.current.length > 0 && acc.words.length < maxWords) {
    acc.words.push(acc.current);
  }
  return acc.words;
}

function isAssignment(word: string | undefined): boolean {
  return ASSIGNMENT_RE.test(word ?? "");
}

function skipOptions(
  words: readonly string[],
  index: number,
  valueFlags: ReadonlySet<string> = new Set()
): number {
  let cursor = index;
  while (cursor < words.length && (words[cursor]?.startsWith("-") ?? false)) {
    const flag = words[cursor] ?? "";
    cursor += 1;
    if (valueFlags.has(flag) && cursor < words.length) {
      cursor += 1;
    }
  }
  return cursor;
}

/** `@scope/pkg@1.2.3` → `@scope/pkg`（首位 `@` 是 scope 不是版本分隔）。 */
function stripPackageVersion(specifier: string): string {
  const versionSeparator = specifier.lastIndexOf("@");
  return versionSeparator > 0
    ? specifier.slice(0, versionSeparator)
    : specifier;
}

function commandBasename(command: string): string {
  return command.split(PATH_SEPARATOR_RE).pop() ?? command;
}

/** 跳过 `FOO=x BAR=y env -u X ...` 环境前缀，返回真实命令下标。 */
function skipLeadingEnvironment(
  words: readonly string[],
  index: number
): number {
  let cursor = index;
  while (cursor < words.length && isAssignment(words[cursor])) {
    cursor += 1;
  }
  if (commandBasename(words[cursor] ?? "") !== "env") {
    return cursor;
  }
  cursor += 1;
  while (
    cursor < words.length &&
    ((words[cursor]?.startsWith("-") ?? false) || isAssignment(words[cursor]))
  ) {
    cursor += 1;
  }
  return cursor;
}

function packageSpecifierAt(
  words: readonly string[],
  index: number
): string | null {
  const packageIndex = skipOptions(words, index);
  const packageSpecifier = words[packageIndex];
  return packageSpecifier ? stripPackageVersion(packageSpecifier) : null;
}

/** 命令词 → 用于身份匹配的可执行体文本（包运行器解析到包名）。 */
function commandTextAt(words: readonly string[], index: number): string | null {
  const command = words[index];
  if (!command) {
    return null;
  }
  const commandName = commandBasename(command);
  const next = words[index + 1];

  if (DIRECT_PACKAGE_RUNNERS.has(commandName)) {
    return packageSpecifierAt(words, index + 1);
  }
  if ((commandName === "pnpm" || commandName === "yarn") && next === "dlx") {
    return packageSpecifierAt(words, index + 2);
  }
  if (commandName === "npm" && next === "exec") {
    return packageSpecifierAt(words, index + 2);
  }
  if (commandName === "pipx" && next === "run") {
    return packageSpecifierAt(words, index + 2);
  }
  if (PYTHON_RUNNERS.has(commandName) && next === "-m") {
    return words[index + 2] ?? null;
  }
  // `openai codex` / `gh copilot` 双词子命令：整体作为匹配文本。
  if (next && (commandName === "openai" || commandName === "gh")) {
    return `${commandName} ${next}`;
  }
  return commandName;
}

function unwrapEnvAndShellPrefixes(
  words: readonly string[],
  index: number
): number {
  let cursor = skipLeadingEnvironment(words, index);
  while (SHELL_PREFIX_COMMANDS.has(commandBasename(words[cursor] ?? ""))) {
    cursor += 1;
  }
  return cursor;
}

function unwrapExecutorWrapper(
  words: readonly string[],
  index: number
): number | null {
  const commandName = commandBasename(words[index] ?? "");
  if (commandName === "sudo" || commandName === "doas") {
    return skipOptions(words, index + 1, SUDO_OPTION_VALUE_FLAGS);
  }
  if (commandName === "arch") {
    return skipOptions(words, index + 1);
  }
  if (commandName === "mise" && words[index + 1] === "exec") {
    const separatorIndex = words.indexOf("--", index + 2);
    return separatorIndex >= 0 ? separatorIndex + 1 : index + 3;
  }
  if (commandName === "asdf" && words[index + 1] === "exec") {
    return index + 2;
  }
  if (commandName === "direnv" && words[index + 1] === "exec") {
    return index + 3;
  }
  if (commandName === "uv" && words[index + 1] === "run") {
    return skipOptions(words, index + 2);
  }
  return null;
}

/**
 * 解析命令行的「实际可执行体」。逐层剥壳（sudo/doas/arch、mise/asdf/direnv
 * exec、uv run），guard 上限防构造输入死循环。返回 null = 解析不出命令。
 */
export function commandExecutableText(commandLine: string): string | null {
  const words = splitShellCommandWords(commandLine, 24);
  let index = 0;

  for (let guard = 0; guard < 10; guard += 1) {
    index = unwrapEnvAndShellPrefixes(words, index);
    if (!words[index]) {
      return null;
    }
    const nextIndex = unwrapExecutorWrapper(words, index);
    if (nextIndex === null) {
      return commandTextAt(words, index);
    }
    index = nextIndex;
  }
  return null;
}

const TOKEN_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/** 词元边界：只对短小的可执行体文本跑，误报面极小。 */
function tokenBoundaryRe(token: string): RegExp {
  const escaped = token.replace(TOKEN_ESCAPE_RE, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i");
}

interface AgentCommandMatcher {
  id: AgentKind;
  tokens: readonly RegExp[];
}

/** 命令词元来自 catalog 的命令类字段（label 是展示名，不参与命令匹配）。 */
const AGENT_COMMAND_MATCHERS: readonly AgentCommandMatcher[] =
  AGENT_CATALOG.map((entry) => {
    const tokens = new Set<string>([entry.id, entry.detectCmd]);
    for (const alias of entry.detectCmdAliases ?? []) {
      tokens.add(alias);
    }
    tokens.add(entry.expectedProcess);
    const launchWord = entry.launchCmd.split(" ")[0];
    if (launchWord) {
      tokens.add(launchWord);
    }
    return { id: entry.id, tokens: [...tokens].map(tokenBoundaryRe) };
  });

/**
 * 命令行 → agent id。只有可执行体词元命中才算（`echo codex` 不命中）。
 * npm scoped 包（`@openai/codex`）经 `/` 边界自然命中同名词元。
 */
export function matchAgentCommand(
  commandLine: string | null
): AgentKind | null {
  if (!commandLine || commandLine.trim().length === 0) {
    return null;
  }
  const text = commandExecutableText(commandLine);
  if (!text) {
    return null;
  }
  for (const matcher of AGENT_COMMAND_MATCHERS) {
    if (matcher.tokens.some((re) => re.test(text))) {
      return matcher.id;
    }
  }
  return null;
}
