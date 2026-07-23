import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../agent-hooks-install.ts";
import type {
  AgentHookCapability,
  AgentHookIntegration,
  AgentRuntimeSemantics,
} from "./types.ts";

/**
 * pier hook 命令的识别标记（新格式——JSONL emit 脚本方式）。
 * hooks.json command 模板引用此环境变量名。
 */
export const PIER_AGENT_HOOKS_DIR_MARK = "PIER_AGENT_HOOKS_DIR";

/** 嵌入 hook 命令的世代标记（勿用 `#` 注释——命令经 `;` 拼成单行）。 */
export const PIER_HOOK_GEN_MARK = `pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`;

/** 从 hook command 文本解析世代；无标记视为 1（旧 stdin 内联提取）。 */
export function pierHookCommandGeneration(command: string): number {
  const match = /pier-hook-gen=(\d+)/.exec(command);
  if (!match) {
    return 1;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 1;
}

/**
 * 生成静态 hook 命令（spec §4.4）：通过 emit 脚本写 JSONL，取代旧版 curl。
 * PTY 注入 PIER_AGENT_HOOKS_DIR 环境变量，Pier 外启动的 agent 因变量
 * 缺失直接短路（emit 脚本内部 guard）。
 * 尾部 `|| true` 保证 hook 永远 exit 0，不干扰 agent 本体。
 *
 * 第一个位置参数固定 `agentEventV2`（emit 脚本 kind dispatch），随后是
 * agent id 与 pier 事件名——见 EMIT_SCRIPT 三 kind 契约。
 */
export function pierHookCommand(
  agentId: AgentKind,
  pierEvent: string,
  nativeEvent: string = pierEvent,
  ...payloadShellExpressions: string[]
): string {
  const payloadArgs = payloadShellExpressions
    .map((expression) => ` "${expression}"`)
    .join("");
  return (
    `[ -x "\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" ] && ` +
    `"\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" "agentEventV2" "${agentId}" "${pierEvent}" "${nativeEvent}"${payloadArgs} || true`
  );
}

/** stdin 身份提取前奏（各 stdin 系构造器共用）。 */
function stdinIdentityExtractionLines(): string[] {
  const nodeExecutable = shellDoubleQuote(process.execPath);
  // 优先走当前终端 PIER_AGENT_HOOKS_DIR 里的 extract-stdin-meta（跟该 Pier
  // userData 版本），这样旧 worktree 覆盖全局 hooks.json 命令模板后，只要
  // 命令仍指向 extract-stdin-meta，本 Pier 终端仍能抽出 promptSnippet。
  // 回退：内联 ELECTRON_RUN_AS_NODE（安装本命令的 Pier 的 execPath）。
  const inlineExtract = `ELECTRON_RUN_AS_NODE=1 "${nodeExecutable}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s),o={};for(const k of ["session_id","sessionId","turn_id","tool_use_id","tool_name","agent_id","agent_type","transcript_path"])if(typeof p[k]==="string")o[k]=p[k];const prompt=[p.prompt,p.user_prompt,p.content,p.message].find(v=>typeof v==="string");if(typeof prompt==="string"&&prompt.trim())o.promptSnippet=prompt.slice(0,512);process.stdout.write(Buffer.from(JSON.stringify(o)).toString("base64"))}catch{}})'`;
  const extractMeta = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/extract-stdin-meta`;
  return [
    `_pier_hook_gen=${PIER_HOOK_GEN_MARK}`,
    "_pier_payload=$(cat 2>/dev/null | head -c 65536)",
    `_pier_metadata_b64=$(printf '%s' "$_pier_payload" | { if [ -x "${extractMeta}" ]; then "${extractMeta}"; else ${inlineExtract}; fi; } 2>/dev/null || true)`,
    `_pier_session_id=$(printf '%s' "$_pier_payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p; s/.*"sessionId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_turn_id=$(printf '%s' "$_pier_payload" | sed -n 's/.*"turn_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_tool_use_id=$(printf '%s' "$_pier_payload" | sed -n 's/.*"tool_use_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_tool_name=$(printf '%s' "$_pier_payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_agent_id=$(printf '%s' "$_pier_payload" | sed -n 's/.*"agent_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_agent_type=$(printf '%s' "$_pier_payload" | sed -n 's/.*"agent_type"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `_pier_transcript_path=$(printf '%s' "$_pier_payload" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
  ];
}

const STDIN_IDENTITY_PAYLOAD_ARGS = [
  "$_pier_session_id",
  "$_pier_turn_id",
  "$_pier_tool_use_id",
  "$_pier_tool_name",
  "$_pier_agent_id",
  "$_pier_agent_type",
  "$_pier_transcript_path",
  "$_pier_metadata_b64",
] as const;

export function pierHookCommandWithStdinSessionId(
  agentId: AgentKind,
  pierEvent: string,
  nativeEvent: string = pierEvent
): string {
  return [
    ...stdinIdentityExtractionLines(),
    pierHookCommand(
      agentId,
      pierEvent,
      nativeEvent,
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
  ].join("; ");
}

/**
 * Claude UserPromptSubmit：emit 之后向 stdout 回写 hookSpecificOutput.sessionTitle
 * （双写 provider UI；Pier 仍以 FA sessionTitle 为准）。
 */
export function pierClaudeUserPromptSubmitCommand(agentId: AgentKind): string {
  const nodeExecutable = shellDoubleQuote(process.execPath);
  const deriveAndPrint = `ELECTRON_RUN_AS_NODE=1 "${nodeExecutable}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);const raw=[p.prompt,p.user_prompt,p.content,p.message].find(v=>typeof v==="string");if(typeof raw!=="string")return;let t=String(raw).replace(/\\r\\n/g,"\\n").replace(/\\r/g,"\\n").replace(/\\[Image\\s*#?\\d*\\]/gi," ").replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g," ").replace(/\\s+/g," ").trim();if(!t||/^(hi|hello|hey|yo|sup|你好|您好|嗨|哈喽|在吗|在么)[!?？。.\\s]*$/i.test(t))return;if(t.length>40)t=t.slice(0,40).trimEnd();if(!t||t.includes("\\n"))return;process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",sessionTitle:t,suppressOutput:true}}))}catch{}})'`;
  return [
    ...stdinIdentityExtractionLines(),
    pierHookCommand(
      agentId,
      "PromptSubmit",
      "UserPromptSubmit",
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
    `printf '%s' "$_pier_payload" | ${deriveAndPrint} 2>/dev/null || true`,
  ].join("; ");
}

export interface StdinStatusDispatchCase {
  /** stdin payload 顶层 `status` 字段的原生取值。 */
  nativeStatus: string;
  /** 命中该取值时上报的 pier 规范事件名。 */
  pierEvent: string;
}

/**
 * 按 stdin payload 的 `status` 字段在安装期命令内分发 pier 事件名
 * （事件映射仍在安装时完成——mapping 逻辑写进 hook 命令本身, 接收端保持
 * agent 无关）。未命中任何 case 或 payload 无 status 时回落 fallbackPierEvent,
 * 由集成的 stopAuthority 语义兜底——provider 未来改 payload 只会退化为
 * 现状, 不会伪造终态。
 */
export function pierHookCommandWithStdinStatusDispatch(
  agentId: AgentKind,
  fallbackPierEvent: string,
  nativeEvent: string,
  cases: readonly StdinStatusDispatchCase[]
): string {
  const arms = cases
    .map(
      (entry) => `${entry.nativeStatus}) _pier_event="${entry.pierEvent}" ;;`
    )
    .concat(`*) _pier_event="${fallbackPierEvent}" ;;`)
    .join(" ");
  return [
    ...stdinIdentityExtractionLines(),
    `_pier_status=$(printf '%s' "$_pier_payload" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `case "$_pier_status" in ${arms} esac`,
    pierHookCommand(
      agentId,
      "$_pier_event",
      nativeEvent,
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
  ].join("; ");
}

function shellDoubleQuote(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
}

/**
 * 识别 pier hook 命令。判据仅依赖 PIER_AGENT_HOOKS_DIR marker——HTTP
 * 通路整个删除后, 新旧格式收敛为单一 marker。
 */
export function isPierHookCommand(command: unknown): boolean {
  return (
    typeof command === "string" && command.includes(PIER_AGENT_HOOKS_DIR_MARK)
  );
}

/** 扫描 settings.hooks 下全部 pier command 的最大世代。 */
export function maxPierHookGenerationInSettings(
  settings: Record<string, unknown>
): number {
  let max = 0;
  const visitCommand = (command: unknown): void => {
    if (typeof command !== "string" || !isPierHookCommand(command)) {
      return;
    }
    max = Math.max(max, pierHookCommandGeneration(command));
  };
  const hooks = settings.hooks;
  if (!(hooks && typeof hooks === "object" && !Array.isArray(hooks))) {
    return max;
  }
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (!(entry && typeof entry === "object")) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      visitCommand(record.command);
      const nested = record.hooks;
      if (!Array.isArray(nested)) {
        continue;
      }
      for (const hook of nested) {
        if (hook && typeof hook === "object") {
          visitCommand((hook as { command?: unknown }).command);
        }
      }
    }
  }
  return max;
}

/**
 * 若磁盘上已有更高世代的 pier hook，则保留原配置（防止旧 worktree 降级覆盖）。
 * 否则执行 rewrite。
 */
export function transformPierHooksUnlessNewer(
  settings: Record<string, unknown>,
  rewrite: (s: Record<string, unknown>) => Record<string, unknown>
): Record<string, unknown> {
  if (
    maxPierHookGenerationInSettings(settings) > PIER_HOOK_COMMAND_GENERATION
  ) {
    return settings;
  }
  return rewrite(settings);
}

/**
 * PATH 扫描探测二进制是否存在（loomdesk commandExists 同款, 集成 detect()
 * 的兜底手段）。仅安装/卸载时调用, 频率极低。
 */
export function commandExistsOnPath(command: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) {
      return true;
    }
  }
  return false;
}

/**
 * 读 JSON 配置：文件不存在 → {}（从空开始）；解析失败/非对象 → null
 * （已损坏, 调用方必须放弃写入, 不得破坏用户文件）。
 */
export async function readJsonConfig(
  path: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function atomicWriteFile(
  path: string,
  data: string
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.pier-tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

/**
 * JSON 配置变换落盘：损坏跳过并告警；语义无变化不落盘（保护用户文件既有
 * 格式, 幂等重装/空卸载零副作用）。
 */
export async function transformJsonConfig(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>,
  label: string
): Promise<void> {
  const settings = await readJsonConfig(path);
  if (settings === null) {
    console.warn(`[agent-hooks:${label}] config unparsable, skip:`, path);
    return;
  }
  const next = transform(settings);
  if (next === settings || JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Claude-schema（嵌套 hooks: {Event: [{matcher?, hooks:[{type,command}]}]}）
// 工厂：claude 及其 fork 家族（openclaude/devin/droid/command-code/grok/
// qwen-code 等）共用, 差异仅在配置路径/事件表/matcher 约定。
// ---------------------------------------------------------------------------

export interface NestedHookEventSpec {
  /**
   * 覆盖默认 stdin emit 命令（例如 Claude UserPromptSubmit 双写 sessionTitle）。
   * 未设则 `pierHookCommandWithStdinSessionId`。
   */
  buildCommand?: (agentId: AgentKind) => string;
  /** 工具类事件的 matcher；undefined = 不写 matcher 字段。 */
  matcher?: string;
  /** 该 agent 的原生事件名。 */
  nativeEvent: string;
  /** 安装时写入命令的 pier 规范事件名（activityStatusForHookEvent 词汇）。 */
  pierEvent: string;
}

export interface NestedJsonIntegrationSpec {
  agentId: AgentKind;
  capability: AgentHookCapability;
  configPath: () => string;
  /** 默认：配置文件已存在才安装（loomdesk 语义）。 */
  detect?: () => boolean;
  events: readonly NestedHookEventSpec[];
  runtime: AgentRuntimeSemantics;
  timeoutSeconds?: number;
}

interface NestedHookMatcher {
  hooks: Array<{ command: string; timeout?: number; type: "command" }>;
  matcher?: string;
}

function hooksRecord(
  settings: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

function isPierNestedEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const hooks = (entry as NestedHookMatcher).hooks;
  return (
    Array.isArray(hooks) && hooks.some((h) => isPierHookCommand(h?.command))
  );
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierNestedHooks(
  settings: Record<string, unknown>,
  spec: NestedJsonIntegrationSpec
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  for (const event of spec.events) {
    const current = hooks[event.nativeEvent];
    const existing = Array.isArray(current) ? current : [];
    const kept = existing.filter((entry) => !isPierNestedEntry(entry));
    const pierEntry: NestedHookMatcher = {
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
      hooks: [
        {
          command:
            event.buildCommand?.(spec.agentId) ??
            pierHookCommandWithStdinSessionId(
              spec.agentId,
              event.pierEvent,
              event.nativeEvent
            ),
          timeout: spec.timeoutSeconds ?? 5,
          type: "command",
        },
      ],
    };
    hooks[event.nativeEvent] = [...kept, pierEntry];
  }
  return { ...settings, hooks };
}

/**
 * 纯函数：剔除全部 pier hook 条目, 空事件键一并删除。
 * 无 pier 条目时原样返回输入引用（启动期关→卸载对齐不得空写用户文件）。
 */
export function withoutPierNestedHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierNestedEntry(entry));
    if (kept.length === entries.length) {
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      hooks[key] = kept;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return settings;
  }
  return { ...settings, hooks };
}

export function createNestedJsonIntegration(
  spec: NestedJsonIntegrationSpec
): AgentHookIntegration {
  return {
    capability: spec.capability,
    detect: spec.detect ?? (() => existsSync(spec.configPath())),
    id: spec.agentId,
    runtime: spec.runtime,
    // install 先剔全部 pier 条目再按当前 spec 写入——覆盖「上一版 spec 装过
    // 但本版已移出」的遗留；withPierNestedHooks 只处理当前 spec 内事件，
    // 不会自行清理已经废弃的事件键。
    install: () =>
      transformJsonConfig(
        spec.configPath(),
        (s) =>
          transformPierHooksUnlessNewer(s, (current) =>
            withPierNestedHooks(withoutPierNestedHooks(current), spec)
          ),
        spec.agentId
      ),
    uninstall: () =>
      transformJsonConfig(
        spec.configPath(),
        withoutPierNestedHooks,
        spec.agentId
      ),
  };
}

// ---------------------------------------------------------------------------
// 文本块注入（TOML/YAML 等无解析器场景, loomdesk 的 marker 块模式）。
// ---------------------------------------------------------------------------

const TRAILING_NEWLINES_RE = /\n+$/;

export function pierBlockMarkers(agentId: AgentKind): {
  begin: string;
  end: string;
} {
  return {
    begin: `# >>> pier-agent-status:${agentId} (managed by Pier; do not edit) >>>`,
    end: `# <<< pier-agent-status:${agentId} <<<`,
  };
}

/** 纯函数：替换/追加 marker 块。block 不含 marker 行本身。 */
export function upsertPierTextBlock(
  raw: string,
  agentId: AgentKind,
  block: string
): string {
  const { begin, end } = pierBlockMarkers(agentId);
  const stripped = removePierTextBlock(raw, agentId);
  const body = `${begin}\n${block}\n${end}\n`;
  if (stripped.length === 0) {
    return body;
  }
  return `${stripped.endsWith("\n") ? stripped : `${stripped}\n`}${body}`;
}

/** 纯函数：移除 marker 块；无块时原样返回输入引用。 */
export function removePierTextBlock(raw: string, agentId: AgentKind): string {
  const { begin, end } = pierBlockMarkers(agentId);
  const beginIdx = raw.indexOf(begin);
  if (beginIdx === -1) {
    return raw;
  }
  const endIdx = raw.indexOf(end, beginIdx);
  if (endIdx === -1) {
    return raw;
  }
  const afterEnd = endIdx + end.length;
  const tail = raw.startsWith("\n", afterEnd)
    ? raw.slice(afterEnd + 1)
    : raw.slice(afterEnd);
  const head = raw.slice(0, beginIdx).replace(TRAILING_NEWLINES_RE, "\n");
  return head === "\n" ? tail : head + tail;
}
