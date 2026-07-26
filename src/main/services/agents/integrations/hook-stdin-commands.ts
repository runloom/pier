import {
  GREETING_ONLY_SOURCE,
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  PIER_AGENT_HOOKS_DIR_MARK,
  PIER_HOOK_GEN_MARK,
  pierHookCommand,
  shellDoubleQuote,
} from "./hook-command-core.ts";

/**
 * stdin JSON 身份字段：Claude 系 snake_case 与 Grok 系 camelCase 双键提取。
 * 与 agent-hooks-install `buildExtractStdinMetaScript` 键表必须同步。
 */
const STDIN_IDENTITY_JSON_KEYS =
  '["session_id","sessionId","turn_id","turnId","tool_use_id","toolUseId","tool_name","toolName","agent_id","agentId","agent_type","agentType","transcript_path","transcriptPath"]';

/** sed 从 payload 抽 string 字段：先 snake 再 camel，取首个命中。 */
function sedExtractJsonStringField(snakeKey: string, camelKey: string): string {
  return (
    `sed -n 's/.*"${snakeKey}"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p; ` +
    `s/.*"${camelKey}"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1`
  );
}

/** stdin 身份提取前奏（各 stdin 系构造器共用）。 */
function stdinIdentityExtractionLines(): string[] {
  const nodeExecutable = shellDoubleQuote(process.execPath);
  // 优先走当前终端 PIER_AGENT_HOOKS_DIR 里的 extract-stdin-meta（跟该 Pier
  // userData 版本），这样旧 worktree 覆盖全局 hooks.json 命令模板后，只要
  // 命令仍指向 extract-stdin-meta，本 Pier 终端仍能抽出 promptSnippet。
  // 回退：内联 ELECTRON_RUN_AS_NODE（安装本命令的 Pier 的 execPath）。
  const inlineExtract = `ELECTRON_RUN_AS_NODE=1 "${nodeExecutable}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s),o={};for(const k of ${STDIN_IDENTITY_JSON_KEYS})if(typeof p[k]==="string")o[k]=p[k];const prompt=[p.prompt,p.user_prompt,p.content,p.message].find(v=>typeof v==="string");if(typeof prompt==="string"&&prompt.trim())o.promptSnippet=prompt.slice(0,512);process.stdout.write(Buffer.from(JSON.stringify(o)).toString("base64"))}catch{}})'`;
  const extractMeta = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/extract-stdin-meta`;
  return [
    `_pier_hook_gen=${PIER_HOOK_GEN_MARK}`,
    "_pier_payload=$(cat 2>/dev/null | head -c 65536)",
    `_pier_metadata_b64=$(printf '%s' "$_pier_payload" | { if [ -x "${extractMeta}" ]; then "${extractMeta}"; else ${inlineExtract}; fi; } 2>/dev/null || true)`,
    `_pier_session_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("session_id", "sessionId")})`,
    `_pier_turn_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("turn_id", "turnId")})`,
    `_pier_tool_use_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("tool_use_id", "toolUseId")})`,
    `_pier_tool_name=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("tool_name", "toolName")})`,
    `_pier_agent_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("agent_id", "agentId")})`,
    `_pier_agent_type=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("agent_type", "agentType")})`,
    `_pier_transcript_path=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("transcript_path", "transcriptPath")})`,
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

/** shell 单引号转义——插值进来的表可能含 `'`（如中文引号表）。 */
function shellSingleQuote(value: string): string {
  return value.replaceAll("'", String.raw`'\''`);
}

/**
 * Claude UserPromptSubmit：emit 之后向 stdout 回写 hookSpecificOutput.sessionTitle，
 * 让 Claude 自己的会话列表也有个像样的名字。
 *
 * **这是对第三方 UI 的顺带写入，不是 Pier 标题的真源**——Pier 的 tab 走 FA。
 * 因此这里只做「剥标记 + 挡寒暄 + 硬截断」这个便宜子集，**不复刻**规则层的
 * 首句/前缀/名词化流水线：把那套算法再抄一份进 shell 单行命令，正是我们要
 * 消除的漂移源。常量与寒暄表从 shared 插值，改一处两边同时变。
 */
export function pierClaudeUserPromptSubmitCommand(agentId: AgentKind): string {
  const nodeExecutable = shellDoubleQuote(process.execPath);
  // 先 JSON.stringify 成 JS 字符串字面量，再做 shell 转义——顺序反了会把
  // 转义引入的反斜杠再转义一次。
  const greeting = shellSingleQuote(JSON.stringify(GREETING_ONLY_SOURCE));
  const cap = MAX_AGENT_SESSION_TITLE_LENGTH;
  const deriveAndPrint = `ELECTRON_RUN_AS_NODE=1 "${nodeExecutable}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);const raw=[p.prompt,p.user_prompt,p.content,p.message].find(v=>typeof v==="string");if(typeof raw!=="string")return;let t=String(raw).slice(0,${MAX_PROMPT_SNIPPET_LENGTH}).replace(/\\r\\n/g,"\\n").replace(/\\r/g,"\\n");const m=/<(user_query|user_message|user_prompt|human|query)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/i.exec(t);if(m&&m[2].trim())t=m[2];t=t.replace(/<\\/?(?:user_query|user_message|user_prompt|human|query|system|assistant)\\b[^>]*>/gi," ").replace(/\\[Image\\s*#?\\d*\\]/gi," ").replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g," ").replace(/\\s+/g," ").trim();if(!t||new RegExp(${greeting},"i").test(t))return;if(t.length>${cap}){t=t.slice(0,${cap - 1}).trimEnd()+"…"}if(!t||t.includes("\\n"))return;process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"UserPromptSubmit",sessionTitle:t,suppressOutput:true}}))}catch{}})'`;
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
