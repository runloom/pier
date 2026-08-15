import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  ActivityStatus,
  AgentSessionTitleSource,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import type { AgentTerminalEvidence } from "./agent-turn-event-semantics.ts";
import type {
  SubagentWorkAssociation,
  SubagentWorkPlan,
} from "./subagent-work-associations.ts";

/**
 * ForegroundActivity 聚合器的模型层：常量、双层 slot 结构、层工厂与
 * slot→activity 投影。hook scope 状态选择见 hook-scope-projection.ts。
 *
 * 双层模型（loomdesk pty_command ⊥ agent_hook 分层的 Pier 变体）：
 * - command 层 — OSC 133 C/D、launcher、task lifecycle 驱动的「前台命令存在」。
 *   agent-launch 只是先验（二进制在跑），**不携带会话 status**——
 *   `omp update` 这类非会话子命令因此不会谎报「等待输入」。
 * - hook 层   — 仅 JSONL hook 事件驱动的「agent 会话证据」，status 唯一来源。
 *
 * 两层互不覆写（taskLaunched 清 hook 层是唯一例外——用户显式操作优先）。
 * OSC 与 hook 的到达顺序竞态因此自然消解（loomdesk 需要
 * matchingAgentHookDetails 把 hook 明细拷进命令条目，双层下无需）；
 * `fg` 等 shell 命令也不再摧毁挂起 agent 的会话证据。
 * 对外仍投影为每 panel 至多一条 ForegroundActivity（renderer 契约不变）。
 */

/** debounce 广播批量（EMIT_DEBOUNCE_MS）。 */
export const EMIT_DEBOUNCE_MS = 100;
/** panelClosed 后的通用冷却，吸收迟到 hook/命令事件。 */
export const CLOSE_COOLDOWN_MS = 5000;
/** SessionEnd 后的短冷却——干净收尾不需要 5s，1.5s 足以拦迟到。 */
export const SESSION_END_COOLDOWN_MS = 1500;
/** hook 静默 30min → 清除不再可信的 status（活动证据仍保留, 计数 0）。 */
export const HOOK_FRESH_TTL_MS = 30 * 60 * 1000;
/** 新建层消抖隐藏（hook SessionStart / launch 瞬时命令不闪）。 */
export const VISIBILITY_DEBOUNCE_MS = 250;

/**
 * 子代理事件只做计数, 不改父状态（防 tool→processing 闪跳）。
 * 判据单一来源是 shared/agent-session-actor.ts，本模块不复制一份。
 */
/**
 * 这些集成在 agent 扩展运行时内直接写 JSONL, `pid` 是扩展宿主进程号。
 * Claude/Codex 等 JSON command hook 里的 `pid` 来自 Pier emit 脚本 `$$`,
 * 不是 agent 会话进程, 不得放进此表。
 */
export const PROCESS_SCOPED_HOOK_AGENTS: ReadonlySet<AgentKind> = new Set([
  "amp",
  "kilo",
  "mimo-code",
  "omp",
  "opencode",
  "pi",
]);
export const PANEL_HOOK_SCOPE_KEY = "panel";
/** Ctrl+Z 悬挂族：128 + {SIGSTOP,SIGTSTP} = 145,146,147,148。 */
export const SUSPENDED_JOB_EXIT_CODES: ReadonlySet<number> = new Set([
  145, 146, 147, 148,
]);

export function isSuspendedJobExitCode(code: number | undefined): boolean {
  return code !== undefined && SUSPENDED_JOB_EXIT_CODES.has(code);
}

export interface HookScopeIdentity {
  isolated: boolean;
  key: string;
  retainsPeerScopes: boolean;
  subagentWorkPlan?: SubagentWorkPlan;
}

/**
 * 会话身份——provider 原样上报的事实，不做任何推断。
 * 与 status / sessionTitle 隔离：标题可以缺席或不准，身份不能被猜。
 */
export interface HookIdentityFacts {
  actorHint?: "main" | "subagent";
  parentSessionId?: string;
  sessionId?: string;
}

/**
 * hook 事件 → 身份事实（缺席即缺席，不补默认值）。
 * 子会话事件一律返回空：面板行身份只能由主会话事件推进。
 */
export function hookIdentityFacts(
  event: AgentHookEventPayload
): HookIdentityFacts {
  if (isSubagentHookEvent(event)) {
    return {};
  }
  const sessionId = event.sessionId?.trim();
  const actorHint = "actorHint" in event ? event.actorHint : undefined;
  // 现判据下带父会话号即算子会话（上面已返回），这里只有判据收窄后
  // 「主会话自己被委派」的场景才会命中：委派边照原样记录。
  const parentSessionId =
    "parentSessionId" in event ? event.parentSessionId?.trim() : undefined;
  return {
    ...(actorHint ? { actorHint } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export interface HookScope {
  activeInteractionIds: Set<string>;
  /**
   * 可被后续普通 ToolStart 顶替的未闭环交互：plan 审批门，以及仅以
   * ToolStart 出现、没有具名 InteractionRequested 闭环的阻塞问卷。
   */
  activePlanInteractionIds: Set<string>;
  activeSubagentIds: Set<string>;
  activeToolIds: Set<string>;
  anonymousInteractionCount: number;
  anonymousSubagentCount: number;
  anonymousToolCount: number;
  completionObserved: boolean;
  /**
   * advisory Stop 观察到完成的时刻；与 turnEndedAt 一起供投影判定
   * 「已结算 session 是否应压过尚未开新回合的 panel 兜底噪声」。
   */
  completionObservedAt: number | undefined;
  currentTurnId: string | undefined;
  /** 当前 scope 的主会话身份事实；hook.identity 只是选中 scope 的镜像。 */
  identity: HookIdentityFacts;
  interactionHistoryIncomplete: boolean;
  key: string;
  recentSettledTurnIds: Set<string>;
  settledInteractionIds: Set<string>;
  settledSubagentIds: Set<string>;
  settledToolIds: Set<string>;
  stale: boolean;
  stateStartedAt: number | undefined;
  status: ActivityStatus | undefined;
  subagentCount: number;
  /** 当前可信终态证据；新回合重置时清空，只允许按强度单调增强。 */
  terminalEvidence: AgentTerminalEvidence | undefined;
  toolHistoryIncomplete: boolean;
  turnEnded: boolean;
  /** 可信终态落定时刻（TurnCompleted / 权威 Stop 等）。 */
  turnEndedAt: number | undefined;
  /** 最近一次回合重置（PromptSubmit / processing / running）时刻。 */
  turnResetAt: number | undefined;
  updatedAt: number;
}

/** hook 层——agent 会话证据。字段只由 hook 事件（及 TTL 衰减）改写。 */
export interface HookLayer {
  activeSubagentWorks: Map<string, SubagentWorkAssociation>;
  agentId: AgentKind;
  /** SessionStart 消抖隐藏期为 true——不参与投影。 */
  hidden: boolean;
  /** 当前选中 scope 的身份镜像；事实所有权在 HookScope.identity。 */
  identity: HookIdentityFacts;
  nextSubagentWorkId: number;
  scopes: Map<string, HookScope>;
  settledSubagentWorks: Map<string, SubagentWorkAssociation>;
  spawnedAt: number;
  stateStartedAt: number | undefined;
  status: ActivityStatus | undefined;
  subagentAssociationHistoryIncomplete: boolean;
  subagentCount: number;
  subagentWorkIdsByAlias: Map<string, Set<string>>;
  ttlTimer: NodeJS.Timeout | null;
  updatedAt: number;
  visibilityTimer: NodeJS.Timeout | null;
  windowId: string;
}

/** command 层：agent 先验——只证明二进制在跑, 无会话 status。 */
export interface AgentLaunchLayer {
  agentId: AgentKind;
  /** 消抖隐藏期为 true——不参与投影。 */
  hidden: boolean;
  kind: "agent-launch";
  spawnedAt: number;
  updatedAt: number;
  visibilityTimer: NodeJS.Timeout | null;
  windowId: string;
}

/** command 层：普通 shell 命令。 */
export interface ShellLayer {
  commandLine: string;
  kind: "shell";
  spawnedAt: number;
  updatedAt: number;
  windowId: string;
}

/** command 层：pier task（用户显式触发，仅占位指针无 status）。 */
export interface TaskLayer {
  kind: "task";
  label: string;
  runId: string;
  spawnedAt: number;
  taskId: string;
  updatedAt: number;
  windowId: string;
}

export type CommandLayer = AgentLaunchLayer | ShellLayer | TaskLayer;

/** 每 panel 一个 slot：两层独立生灭, 投影时合成一条 activity。 */
export interface PanelSlot {
  command: CommandLayer | null;
  hook: HookLayer | null;
  panelId: string;
  /** 产品会话名（与 status 隔离；挂 panel 而非 hook 层）。 */
  sessionTitle?: string;
  /** 标题所属的 provider 主会话；不向 renderer 投影。 */
  sessionTitleSessionId?: string;
  sessionTitleSource?: AgentSessionTitleSource;
}

export interface TimerCtx {
  now: () => number;
  scheduleEmit: () => void;
  slots: Map<string, PanelSlot>;
}

export function clearHookTimers(hook: HookLayer): void {
  if (hook.ttlTimer) {
    clearTimeout(hook.ttlTimer);
    hook.ttlTimer = null;
  }
  if (hook.visibilityTimer) {
    clearTimeout(hook.visibilityTimer);
    hook.visibilityTimer = null;
  }
}

export function clearCommandTimers(command: CommandLayer): void {
  if (command.kind === "agent-launch" && command.visibilityTimer) {
    clearTimeout(command.visibilityTimer);
    command.visibilityTimer = null;
  }
}

export function clearSlotTimers(slot: PanelSlot): void {
  if (slot.hook) {
    clearHookTimers(slot.hook);
  }
  if (slot.command) {
    clearCommandTimers(slot.command);
  }
}

export function hookScopeIdentity(
  event: AgentHookEventPayload
): HookScopeIdentity {
  const retainsPeerScopes = PROCESS_SCOPED_HOOK_AGENTS.has(event.agent);
  const sessionId = event.sessionId?.trim();
  if (sessionId) {
    return {
      isolated: true,
      key: `session:${sessionId}`,
      retainsPeerScopes,
    };
  }
  if (retainsPeerScopes && typeof event.pid === "number") {
    return {
      isolated: true,
      key: `process:${event.pid}`,
      retainsPeerScopes,
    };
  }
  return {
    isolated: false,
    key: PANEL_HOOK_SCOPE_KEY,
    retainsPeerScopes,
  };
}

export function newHookScope(
  key: string,
  at: number,
  identity: HookIdentityFacts = {}
): HookScope {
  return {
    activeInteractionIds: new Set(),
    activePlanInteractionIds: new Set(),
    activeSubagentIds: new Set(),
    activeToolIds: new Set(),
    anonymousInteractionCount: 0,
    anonymousSubagentCount: 0,
    anonymousToolCount: 0,
    completionObserved: false,
    completionObservedAt: undefined,
    currentTurnId: undefined,
    identity,
    interactionHistoryIncomplete: false,
    key,
    recentSettledTurnIds: new Set(),
    settledInteractionIds: new Set(),
    settledSubagentIds: new Set(),
    settledToolIds: new Set(),
    stale: false,
    stateStartedAt: undefined,
    status: undefined,
    subagentCount: 0,
    terminalEvidence: undefined,
    turnEnded: false,
    turnEndedAt: undefined,
    turnResetAt: undefined,
    toolHistoryIncomplete: false,
    updatedAt: at,
  };
}

export function getOrCreateHookScope(
  hook: HookLayer,
  identity: HookScopeIdentity,
  event: AgentHookEventPayload,
  at: number
): HookScope {
  const existing = hook.scopes.get(identity.key);
  if (existing) {
    return existing;
  }
  const scope = newHookScope(identity.key, at, hookIdentityFacts(event));
  hook.scopes.set(identity.key, scope);
  return scope;
}

export function newHookLayer(
  event: AgentHookEventPayload,
  at: number,
  startsHidden: boolean
): HookLayer {
  return {
    agentId: event.agent,
    hidden: startsHidden,
    identity: {},
    spawnedAt: at,
    stateStartedAt: undefined,
    status: undefined,
    scopes: new Map(),
    subagentCount: 0,
    activeSubagentWorks: new Map(),
    nextSubagentWorkId: 0,
    settledSubagentWorks: new Map(),
    subagentAssociationHistoryIncomplete: false,
    subagentWorkIdsByAlias: new Map(),
    ttlTimer: null,
    updatedAt: at,
    visibilityTimer: null,
    windowId: event.windowId,
  };
}

export function newAgentLaunchLayer(
  windowId: string,
  agentId: AgentKind,
  at: number
): AgentLaunchLayer {
  return {
    agentId,
    hidden: true,
    kind: "agent-launch",
    spawnedAt: at,
    updatedAt: at,
    visibilityTimer: null,
    windowId,
  };
}

export function newShellLayer(
  windowId: string,
  commandLine: string,
  at: number
): ShellLayer {
  return {
    commandLine: commandLine.slice(0, 4096),
    kind: "shell",
    spawnedAt: at,
    updatedAt: at,
    windowId,
  };
}

export function newTaskLayer(
  windowId: string,
  taskId: string,
  label: string,
  runId: string,
  at: number
): TaskLayer {
  return {
    kind: "task",
    label,
    runId,
    spawnedAt: at,
    taskId,
    updatedAt: at,
    windowId,
  };
}

/**
 * slot → 对外 activity 投影（纯函数）。
 * 优先级：task > hook(可见) > agent-launch(可见) > shell。
 * hook 证据优先于 launch 先验——`fg` 覆盖 command 层后 agent 会话照常呈现;
 * launch 先验投影**不带 status**, renderer 只出品牌图标。
 */
export function projectSlot(
  panelId: string,
  slot: PanelSlot
): ForegroundActivity | null {
  const { command, hook } = slot;
  if (command?.kind === "task") {
    return {
      kind: "task",
      label: command.label,
      panelId,
      spawnedAt: command.spawnedAt,
      taskId: command.taskId,
      runId: command.runId,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
    };
  }
  if (hook && !hook.hidden) {
    return {
      agentId: hook.agentId,
      kind: "agent",
      panelId,
      source: "hook",
      ...hook.identity,
      spawnedAt: hook.spawnedAt,
      ...(hook.status === undefined
        ? {}
        : { stateStartedAt: hook.stateStartedAt, status: hook.status }),
      subagentCount: hook.subagentCount,
      updatedAt: hook.updatedAt,
      windowId: hook.windowId,
      ...(slot.sessionTitle === undefined
        ? {}
        : { sessionTitle: slot.sessionTitle }),
      ...(slot.sessionTitleSource === undefined
        ? {}
        : { sessionTitleSource: slot.sessionTitleSource }),
    };
  }
  // launch 先验没有任何 hook 事实 → 不带身份字段（缺席即证据不足，
  // 消费方按主会话处理）。不得从 launch 命令行反推会话号。
  if (command?.kind === "agent-launch" && !command.hidden) {
    return {
      agentId: command.agentId,
      kind: "agent",
      panelId,
      source: "launch",
      spawnedAt: command.spawnedAt,
      subagentCount: 0,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
      ...(slot.sessionTitle === undefined
        ? {}
        : { sessionTitle: slot.sessionTitle }),
      ...(slot.sessionTitleSource === undefined
        ? {}
        : { sessionTitleSource: slot.sessionTitleSource }),
    };
  }
  if (command?.kind === "shell") {
    return {
      commandLine: command.commandLine,
      kind: "shell",
      panelId,
      spawnedAt: command.spawnedAt,
      updatedAt: command.updatedAt,
      windowId: command.windowId,
    };
  }
  return null;
}
