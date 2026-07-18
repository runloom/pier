import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";

/**
 * ForegroundActivity 聚合器的模型层：常量、双层 slot 结构、层工厂、
 * timer 帮手、回合记账与投影纯函数。
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
/**
 * 新建层的消抖隐藏时长（防瞬时闪条）。hook 层用于 SessionStart；
 * launch 层一律适用——`omp --version` 这类瞬时命令不闪（loomdesk
 * starting 相位同款语义）。
 */
export const VISIBILITY_DEBOUNCE_MS = 250;

/**
 * 回合边界事件（会话切换/错误）——之后的迟到工具事件被吸收。
 * Stop 是否属于可信边界由集成的 `stopAuthority` 决定，不在此处一刀切。
 */
export const TURN_BOUNDARY_EVENTS = new Set([
  "TurnCompleted",
  "TurnInterrupted",
  "error",
]);
/** 回合重置事件（新回合开始）——解除吸收 + 清 subagent 计数。 */
export const TURN_RESET_EVENTS = new Set([
  "PromptSubmit",
  "processing",
  "running",
]);
/** 会话创建事件——只有正向信号才能建 hook 层（幽灵门控）。 */
export const SESSION_CREATING_EVENTS = new Set([
  "SessionStart",
  "PromptSubmit",
  "ToolStart",
  "PermissionRequest",
  "processing",
  "running",
]);
/** 子代理事件只做计数, 不改父状态（防 tool→processing 闪跳）。 */
export const SUBAGENT_EVENTS = new Set(["SubagentStart", "SubagentStop"]);
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
}

export interface HookScope {
  activeSubagentIds: Set<string>;
  activeToolIds: Set<string>;
  anonymousSubagentCount: number;
  anonymousToolCount: number;
  completionObserved: boolean;
  currentTurnId: string | undefined;
  key: string;
  recentSettledTurnIds: Set<string>;
  stale: boolean;
  stateStartedAt: number;
  status: ActivityStatus | undefined;
  subagentCount: number;
  turnEnded: boolean;
  updatedAt: number;
}

/** hook 层——agent 会话证据。字段只由 hook 事件（及 TTL 衰减）改写。 */
export interface HookLayer {
  agentId: AgentKind;
  /** SessionStart 消抖隐藏期为 true——不参与投影。 */
  hidden: boolean;
  scopes: Map<string, HookScope>;
  spawnedAt: number;
  stateStartedAt: number | undefined;
  status: ActivityStatus | undefined;
  subagentCount: number;
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
  const sessionId = event.sessionId?.trim();
  if (sessionId) {
    return { isolated: true, key: `session:${sessionId}` };
  }
  if (
    PROCESS_SCOPED_HOOK_AGENTS.has(event.agent) &&
    typeof event.pid === "number"
  ) {
    return { isolated: true, key: `process:${event.pid}` };
  }
  return { isolated: false, key: PANEL_HOOK_SCOPE_KEY };
}

export function newHookScope(key: string, at: number): HookScope {
  return {
    activeSubagentIds: new Set(),
    activeToolIds: new Set(),
    anonymousSubagentCount: 0,
    anonymousToolCount: 0,
    completionObserved: false,
    currentTurnId: undefined,
    key,
    recentSettledTurnIds: new Set(),
    stale: false,
    stateStartedAt: at,
    status: "ready",
    subagentCount: 0,
    turnEnded: false,
    updatedAt: at,
  };
}

export function getOrCreateHookScope(
  hook: HookLayer,
  identity: HookScopeIdentity,
  at: number
): HookScope {
  const existing = hook.scopes.get(identity.key);
  if (existing) {
    return existing;
  }
  const scope = newHookScope(identity.key, at);
  hook.scopes.set(identity.key, scope);
  return scope;
}

const STATUS_PRIORITY: Record<ActivityStatus, number> = {
  error: 2,
  processing: 3,
  ready: 1,
  tool: 4,
  waiting: 5,
};

function statusPriority(status: ActivityStatus | undefined): number {
  // “已观察到完成但尚无可信终态”不能覆盖 error，也不能被旧 ready 掩盖。
  return status === undefined ? 1.5 : STATUS_PRIORITY[status];
}

function projectedScopeStatus(scope: HookScope): ActivityStatus | undefined {
  return scope.stale ? undefined : scope.status;
}

function preferredScope(current: HookScope, candidate: HookScope): HookScope {
  const currentPriority = statusPriority(projectedScopeStatus(current));
  const candidatePriority = statusPriority(projectedScopeStatus(candidate));
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority ? candidate : current;
  }
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

export function refreshHookProjection(hook: HookLayer, at?: number): void {
  let selected: HookScope | null = null;
  let maxUpdatedAt = hook.updatedAt;
  let subagentCount = 0;
  for (const scope of hook.scopes.values()) {
    selected = selected ? preferredScope(selected, scope) : scope;
    maxUpdatedAt = Math.max(maxUpdatedAt, scope.updatedAt);
    subagentCount +=
      scope.activeSubagentIds.size + scope.anonymousSubagentCount;
  }
  if (!selected) {
    return;
  }
  const selectedStatus = projectedScopeStatus(selected);
  const previousStatus = hook.status;
  hook.status = selectedStatus;
  if (selectedStatus === undefined) {
    hook.stateStartedAt = undefined;
  } else if (selectedStatus !== previousStatus) {
    hook.stateStartedAt = at ?? selected.stateStartedAt;
  }
  hook.subagentCount = subagentCount;
  hook.updatedAt = Math.max(maxUpdatedAt, at ?? 0);
}

export function setHookScopeStatus(
  hook: HookLayer,
  scope: HookScope,
  status: ActivityStatus | undefined,
  at: number
): void {
  if (scope.status !== status) {
    scope.status = status;
    scope.stateStartedAt = at;
  }
  scope.stale = false;
  scope.updatedAt = at;
  refreshHookProjection(hook, at);
}

/** hook 静默后只失去具体状态置信度，不得凭超时伪造 ready。 */
export function armHookTtlTimer(key: string, ctx: TimerCtx): void {
  const hook = ctx.slots.get(key)?.hook;
  if (!hook) {
    return;
  }
  if (hook.ttlTimer) {
    clearTimeout(hook.ttlTimer);
    hook.ttlTimer = null;
  }
  const expiringScopes = [...hook.scopes.values()].filter(
    (scope) =>
      !(scope.turnEnded || scope.stale) &&
      scope.status !== undefined &&
      scope.status !== "ready" &&
      scope.status !== "error"
  );
  if (expiringScopes.length === 0) {
    return;
  }
  const nextExpiry = Math.min(
    ...expiringScopes.map((scope) => scope.updatedAt + HOOK_FRESH_TTL_MS)
  );
  hook.ttlTimer = setTimeout(
    () => {
      const current = ctx.slots.get(key)?.hook;
      if (!current) {
        return;
      }
      current.ttlTimer = null;
      const at = ctx.now();
      let changed = false;
      for (const scope of current.scopes.values()) {
        if (
          !(scope.turnEnded || scope.stale) &&
          scope.status !== undefined &&
          scope.status !== "ready" &&
          scope.status !== "error" &&
          at - scope.updatedAt >= HOOK_FRESH_TTL_MS
        ) {
          scope.stale = true;
          changed = true;
        }
      }
      if (changed) {
        refreshHookProjection(current);
        ctx.scheduleEmit();
      }
      armHookTtlTimer(key, ctx);
    },
    Math.max(0, nextExpiry - ctx.now())
  );
}

export function newHookLayer(
  event: AgentHookEventPayload,
  at: number
): HookLayer {
  return {
    agentId: event.agent,
    hidden: event.event === "SessionStart",
    spawnedAt: at,
    stateStartedAt: at,
    status: "ready",
    scopes: new Map(),
    subagentCount: 0,
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
      spawnedAt: hook.spawnedAt,
      ...(hook.status === undefined
        ? {}
        : { stateStartedAt: hook.stateStartedAt, status: hook.status }),
      subagentCount: hook.subagentCount,
      updatedAt: hook.updatedAt,
      windowId: hook.windowId,
    };
  }
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
