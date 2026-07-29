import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent-session.ts";
import { PIER_HOOK_COMMAND_GENERATION } from "../agent-hooks-install.ts";

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
  const payloadShellExpressions = [
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
  ];
  const payloadArgs = payloadShellExpressions
    .map((expression) => ` "${expression ?? ""}"`)
    .join("");
  return (
    `[ -x "\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" ] && ` +
    `"\${${PIER_AGENT_HOOKS_DIR_MARK}}/emit" "agentEventV3" "${spec.agentId}" "${spec.event}" "${spec.nativeEvent}"${payloadArgs} || true`
  );
}

/** 识别实际执行规范 emit 路径的新旧 Pier hook 命令。 */
export function isPierHookCommand(command: unknown): boolean {
  return typeof command === "string" && PIER_EMIT_INVOCATION_RE.test(command);
}
