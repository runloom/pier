import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../../hooks-install.ts";

/**
 * pier hook 命令的识别标记（新格式——JSONL emit 脚本方式）。
 * hooks.json command 模板引用此环境变量名。
 */
export const PIER_AGENT_HOOKS_DIR_MARK = "PIER_AGENT_HOOKS_DIR";

/** 嵌入 hook 命令的世代标记（勿用 `#` 注释——命令经 `;` 拼成单行）。 */
export const PIER_HOOK_GEN_MARK = `pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}`;

const SAFE_ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PIER_EMIT_INVOCATION_RE =
  /(?:^|&&|\|\||[;{(])\s*["']?\$\{PIER_AGENT_HOOKS_DIR\}\/emit["']?(?=\s|$)/;

/**
 * 外部兼容宿主会加载其他提供方的 hook 配置。命中宿主标志变量时整条命令
 * 静默跳过，既不消费 stdin，也不改变宿主退出码。
 */
export function skipHookCommandWhenEnvPresent(
  command: string,
  environmentVariables: readonly string[] | undefined
): string {
  const guards = (environmentVariables ?? [])
    .filter((name) => SAFE_ENVIRONMENT_VARIABLE_NAME.test(name))
    .map((name) => `[ -z "\${${name}+x}" ]`);
  if (guards.length === 0) {
    return command;
  }
  return `${guards.join(" && ")} && { ${command}; } || true`;
}

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

type AgentHookEventV3Name = AgentHookEventPayloadV3["event"];
type StandardAgentHookEventV3Name = Exclude<
  AgentHookEventV3Name,
  "InteractionRequested" | "InteractionResolved"
>;
type InteractionRequestedV3 = Extract<
  AgentHookEventPayloadV3,
  { event: "InteractionRequested" }
>;
type InteractionResolvedV3 = Extract<
  AgentHookEventPayloadV3,
  { event: "InteractionResolved" }
>;

interface PierHookCommandV3CommonSpec {
  /** 静态角色事实；不要从工具名或任意 payload 字段推断。 */
  actorHint?: "main" | "subagent";
  agentId: AgentKind;
  /** 以下 string 是受信任的 shell 表达式，构造器会逐项加双引号。 */
  agentInstanceId?: string;
  agentType?: string;
  metadataBase64?: string;
  nativeEvent: string;
  nativeState?: string;
  parentSessionId?: string;
  promptSnippet?: string;
  sessionId?: string;
  toolName?: string;
  toolUseId?: string;
  transcriptPath?: string;
  turnId?: string;
}

export type PierHookCommandV3Spec = PierHookCommandV3CommonSpec &
  (
    | {
        event: StandardAgentHookEventV3Name;
        interactionId?: never;
        interactionKind?: never;
        interactionOutcome?: never;
      }
    | {
        event: "InteractionRequested";
        interactionId?: string;
        interactionKind: InteractionRequestedV3["interactionKind"];
        interactionOutcome?: never;
      }
    | {
        event: "InteractionResolved";
        interactionId?: string;
        interactionKind: InteractionResolvedV3["interactionKind"];
        interactionOutcome?: InteractionResolvedV3["interactionOutcome"];
      }
  );

/**
 * 构造新配置使用的严格 v3 hook 命令。
 *
 * 对象字段与 `agentHookEventSchema` 一一对应；交互事件使用判别联合，标准事件
 * 无法夹带交互字段，也不再接受旧单边 `PermissionRequest`。等待事实必须使用
 * InteractionRequested/Resolved；旧 `pierHookCommand` 仍固定发射 v2，供已安装
 * 配置兼容。
 */
function formatAgentEventV3Command(
  agentId: AgentKind,
  event: string,
  nativeEvent: string,
  payloadShellExpressions: Array<string | undefined>
): string {
  const payloadArgs = payloadShellExpressions
    .map((expression) => ` "${expression ?? ""}"`)
    .join("");
  return (
    `[ -x "\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" ] && ` +
    `"\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" "agentEventV3" "${agentId}" "${event}" "${nativeEvent}"${payloadArgs} || true`
  );
}

export function pierHookCommandV3(spec: PierHookCommandV3Spec): string {
  let interactionShellExpressions: Array<string | undefined> = [
    undefined,
    undefined,
    undefined,
  ];
  if (spec.event === "InteractionRequested") {
    interactionShellExpressions = [
      spec.interactionId,
      spec.interactionKind,
      undefined,
    ];
  } else if (spec.event === "InteractionResolved") {
    interactionShellExpressions = [
      spec.interactionId,
      spec.interactionKind,
      spec.interactionOutcome,
    ];
  }
  return formatAgentEventV3Command(spec.agentId, spec.event, spec.nativeEvent, [
    spec.sessionId,
    spec.turnId,
    spec.toolUseId,
    spec.toolName,
    spec.agentInstanceId,
    spec.agentType,
    spec.transcriptPath,
    spec.metadataBase64,
    spec.parentSessionId,
    spec.actorHint,
    spec.nativeState,
    ...interactionShellExpressions,
    spec.promptSnippet,
  ]);
}

/**
 * 安装期 shell 分发用 v3 emit：event 可以是 shell 变量（如 `$_pier_event`）。
 *
 * emit 脚本按展开后的事件名决定是否写入 interaction 字段；因此这里**始终**
 * 带上 interaction 三个槽位（未命中交互工具时为空字符串）。调用方须保证
 * 所有表达式受信任（仅固定字面量或本命令内赋值的 `$_pier_*`）。
 */
export function pierHookCommandV3ShellDispatched(
  spec: PierHookCommandV3CommonSpec & {
    event: string;
    interactionId?: string;
    interactionKind?: string;
    interactionOutcome?: string;
  }
): string {
  return formatAgentEventV3Command(spec.agentId, spec.event, spec.nativeEvent, [
    spec.sessionId,
    spec.turnId,
    spec.toolUseId,
    spec.toolName,
    spec.agentInstanceId,
    spec.agentType,
    spec.transcriptPath,
    spec.metadataBase64,
    spec.parentSessionId,
    spec.actorHint,
    spec.nativeState,
    spec.interactionId,
    spec.interactionKind,
    spec.interactionOutcome,
    spec.promptSnippet,
  ]);
}

/** 识别实际执行规范 emit 路径的新旧 Pier hook 命令。 */
export function isPierHookCommand(command: unknown): boolean {
  return typeof command === "string" && PIER_EMIT_INVOCATION_RE.test(command);
}

/**
 * HTTP loopback 时代的 Pier hook（`PIER_AGENT_HOOK_PORT` + curl）。
 *
 * 自 JSONL emit 切换后 `isPierHookCommand` 故意不再匹配它们，以免把
 * 世代探测当成“新格式”。但用户磁盘上的孤儿 curl 条目仍会在每次
 * Pre/PostToolUse 时起子进程（环境无 PORT 时短路失败），并在 Grok 兼容
 * 加载 Claude/Cursor hooks 时污染 `[hooks: n/m]` 注解。install / uninstall
 * 必须能清掉这些遗留行。
 */
export function isLegacyPierHttpHookCommand(command: unknown): boolean {
  return (
    typeof command === "string" && command.includes("PIER_AGENT_HOOK_PORT")
  );
}

/** install/uninstall 所有权：emit 规范命令 + 遗留 HTTP curl。 */
export function isManagedPierHookCommand(command: unknown): boolean {
  return isPierHookCommand(command) || isLegacyPierHttpHookCommand(command);
}
