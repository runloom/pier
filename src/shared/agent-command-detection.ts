import { AGENT_CATALOG } from "./agent-catalog.ts";
import type { AgentCatalogEntry, AgentKind } from "./contracts/agent.ts";

/**
 * 命令行 → agent 身份探测（loomdesk activity-command-detection 移植）。
 *
 * 核心原则：agent pattern 只对「可执行体词元」匹配，绝不扫全命令行——
 * `echo codex`、`curl https://claude.ai/x`、路径/分支名都不产生身份。
 * catalog `id` / `label` 也不是可执行体：`cursor .` 是编辑器启动器，身份是
 * `cursor-agent`；光杆 `agent` 不得点亮 Cursor（安装探测另做路径落地）。
 * 安装探测 `expectedBins` 里的独特 CLI 必须能被 OSC 认到（`kimi-cli` /
 * `qoderclicn`）；ACP 别名（`vibe-acp`）只进 catalog，避免双 bin 安装冲突。
 * 泛名进 AGENT_OSC_BIN_DENYLIST。`qoder` / `qodercn` 是 CLI+IDE 合一启动器
 * （同 `cursor`），按 argv 分流，不能当纯词元。
 * 可执行体由 commandExecutableText 解析：剥 env 前缀与 wrapper（sudo/env/
 * mise 等），解析包运行器（npx/pnpm dlx/pipx run/python -m）的包名。
 */

/**
 * 安装期会枚举、但 OSC 词元不得使用的 basename。
 * `agent`：Cursor 安装器符号链接，与 Grok 抢名。
 * `acli`：Atlassian 万能 CLI；Rovo 只走 launchCommandPrefix。
 */
export const AGENT_OSC_BIN_DENYLIST: ReadonlySet<string> = new Set([
  "agent",
  "acli",
]);

const PATH_SEPARATOR_RE = /[\\/]/;
/** 未加引号的 `C:\Users`：保留 `\` 作为路径分隔，而不是 POSIX 吞掉。 */
const WINDOWS_PATH_AFTER_BACKSLASH_RE = /[A-Za-z0-9._-]/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
/** `file.ts` / `README.md`；`3.14` 不命中（后缀须以字母起）。 */
const FILE_EXTENSION_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

const QODER_EXCLUSIVE_CLI_BINS: ReadonlySet<string> = new Set([
  "qodercli",
  "qoderclicn",
]);

/**
 * V1.1.18+ 合一启动器：光杆 / `-` 参数走 CLI；路径和 IDE 子命令开 IDE。
 * https://developer.aliyun.com/article/1754898
 * 光杆目录名 vs 单词 prompt（`qoder src`）L1 分不开，不猜。
 */
const QODER_UNIFIED_LAUNCHERS: ReadonlySet<string> = new Set([
  "qoder",
  "qodercn",
]);
const QODER_IDE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "desktop",
  "ide",
  "chat",
  "serve-web",
  "tunnel",
]);

function looksLikeFilesystemPathArg(arg: string): boolean {
  if (
    arg === "." ||
    arg === ".." ||
    arg === "~" ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.startsWith("~/") ||
    arg.startsWith("/") ||
    WINDOWS_DRIVE_RE.test(arg) ||
    PATH_SEPARATOR_RE.test(arg) ||
    FILE_EXTENSION_RE.test(arg)
  ) {
    return true;
  }
  return arg.startsWith(".") && arg !== "." && arg !== "..";
}

/** OSC / matchAgentCommand 使用的可执行体词元（不含产品 id、不含 denylist）。 */
export function catalogCommandIdentityBins(
  entry: AgentCatalogEntry
): readonly string[] {
  if (entry.launchCommandPrefix) {
    return [];
  }
  const tokens = new Set<string>([entry.detectCmd, entry.expectedProcess]);
  for (const alias of entry.detectCmdAliases ?? []) {
    tokens.add(alias);
  }
  const launchWord = entry.launchCmd.split(" ")[0];
  if (launchWord) {
    tokens.add(launchWord);
  }
  for (const denied of AGENT_OSC_BIN_DENYLIST) {
    tokens.delete(denied);
  }
  return [...tokens];
}

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
    if (!acc.quote && WINDOWS_PATH_AFTER_BACKSLASH_RE.test(char)) {
      acc.current += `\\${char}`;
    } else {
      acc.current += char;
    }
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

function packageWordIndex(
  words: readonly string[],
  commandIndex: number
): number | null {
  const commandName = commandBasename(words[commandIndex] ?? "").toLowerCase();
  const next = words[commandIndex + 1];
  if (DIRECT_PACKAGE_RUNNERS.has(commandName)) {
    return skipOptions(words, commandIndex + 1);
  }
  if ((commandName === "pnpm" || commandName === "yarn") && next === "dlx") {
    return skipOptions(words, commandIndex + 2);
  }
  if (commandName === "npm" && next === "exec") {
    return skipOptions(words, commandIndex + 2);
  }
  if (commandName === "pipx" && next === "run") {
    return skipOptions(words, commandIndex + 2);
  }
  if (PYTHON_RUNNERS.has(commandName) && next === "-m") {
    return commandIndex + 2;
  }
  return null;
}

/** 命令词 → 用于身份匹配的可执行体文本（包运行器解析到包名）。 */
function commandTextAt(words: readonly string[], index: number): string | null {
  const command = words[index];
  if (!command) {
    return null;
  }
  const commandName = commandBasename(command);
  const next = words[index + 1];
  const pkgIndex = packageWordIndex(words, index);
  if (pkgIndex !== null) {
    const spec = words[pkgIndex];
    return spec ? stripPackageVersion(spec) : null;
  }
  if (next && (commandName === "openai" || commandName === "gh")) {
    return `${commandName} ${next}`;
  }
  return commandName;
}

function qoderBinAndNext(
  words: readonly string[],
  index: number
): { bin: string; next: string | undefined } {
  const pkgIndex = packageWordIndex(words, index);
  if (pkgIndex !== null) {
    const spec = stripPackageVersion(words[pkgIndex] ?? "");
    return {
      bin: commandBasename(spec).toLowerCase(),
      next: words[pkgIndex + 1],
    };
  }
  return {
    bin: commandBasename(words[index] ?? "").toLowerCase(),
    next: words[index + 1],
  };
}

/** 独占 CLI 恒认；合一启动器排除 IDE 打开形态。大小写不敏感。 */
function matchQoderFamilyCommand(
  words: readonly string[],
  index: number
): AgentKind | null {
  const { bin, next } = qoderBinAndNext(words, index);
  if (QODER_EXCLUSIVE_CLI_BINS.has(bin)) {
    return "qodercli";
  }
  if (!QODER_UNIFIED_LAUNCHERS.has(bin)) {
    return null;
  }
  if (!next || next.startsWith("-")) {
    return "qodercli";
  }
  if (
    QODER_IDE_SUBCOMMANDS.has(next.toLowerCase()) ||
    looksLikeFilesystemPathArg(next)
  ) {
    return null;
  }
  return "qodercli";
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
  const resolved = resolveCommandWords(commandLine);
  return resolved ? commandTextAt(resolved.words, resolved.index) : null;
}

interface ResolvedCommandWords {
  index: number;
  words: readonly string[];
}

function resolveCommandWords(commandLine: string): ResolvedCommandWords | null {
  const words = splitShellCommandWords(commandLine, 24);
  let index = 0;

  for (let guard = 0; guard < 10; guard += 1) {
    index = unwrapEnvAndShellPrefixes(words, index);
    if (!words[index]) {
      return null;
    }
    const nextIndex = unwrapExecutorWrapper(words, index);
    if (nextIndex === null) {
      return { index, words };
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

type AgentCommandMatcher =
  | {
      id: AgentKind;
      launchCommandPrefix: readonly [string, ...string[]];
      tokens?: never;
    }
  | {
      id: AgentKind;
      launchCommandPrefix?: never;
      tokens: readonly RegExp[];
    };

/** 命令词元只来自 catalog 的命令类字段；产品 id / label 不参与。 */
const AGENT_COMMAND_MATCHERS: readonly AgentCommandMatcher[] =
  AGENT_CATALOG.map((entry) => {
    if (entry.launchCommandPrefix) {
      return {
        id: entry.id,
        launchCommandPrefix: entry.launchCommandPrefix,
      };
    }
    return {
      id: entry.id,
      tokens: catalogCommandIdentityBins(entry).map(tokenBoundaryRe),
    };
  });

function matchesLaunchCommandPrefix(
  words: readonly string[],
  commandIndex: number,
  prefix: readonly [string, ...string[]]
): boolean {
  return prefix.every((expected, offset) => {
    const actual = words[commandIndex + offset];
    return offset === 0
      ? commandBasename(actual ?? "") === expected
      : actual === expected;
  });
}

/**
 * 命令行 → agent id。只有可执行体词元命中才算（`echo codex`、`cursor .` 不命中）。
 * npm scoped 包（`@openai/codex`）经 `/` 边界自然命中同名词元。
 */
export function matchAgentCommand(
  commandLine: string | null
): AgentKind | null {
  if (!commandLine || commandLine.trim().length === 0) {
    return null;
  }
  const resolved = resolveCommandWords(commandLine);
  if (!resolved) {
    return null;
  }
  const qoderId = matchQoderFamilyCommand(resolved.words, resolved.index);
  if (qoderId) {
    return qoderId;
  }
  const text = commandTextAt(resolved.words, resolved.index);
  if (!text) {
    return null;
  }
  for (const matcher of AGENT_COMMAND_MATCHERS) {
    if (
      matcher.launchCommandPrefix
        ? matchesLaunchCommandPrefix(
            resolved.words,
            resolved.index,
            matcher.launchCommandPrefix
          )
        : matcher.tokens.some((re) => re.test(text))
    ) {
      return matcher.id;
    }
  }
  return null;
}
