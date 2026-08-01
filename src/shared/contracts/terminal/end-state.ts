/**
 * 终端结果查看态（Terminal End State）— shared 纯函数与类型（阶段 0 / PR1）。
 *
 * 产品路径 A：agent / task 结束后保留面板、显式关闭。
 * 会话结束 ≠ 任务成功：agent 干净退出禁止 tab `succeeded`。
 *
 * 完整单源状态机见：
 * `docs/superpowers/specs/2026-07-30-terminal-end-state-design.md`
 */

import { agentTabIconId } from "../agent/session.ts";
import type { AgentKind } from "../agent.ts";
import type { PanelTabChrome, PanelTabState } from "../panel.ts";
import { normalizePanelTabChromeInput } from "../panel.ts";
import type { TaskRunNodeStatus } from "../tasks.ts";
import { taskRunTabState } from "../tasks.ts";

/** 结果查看角色：决定默认 dismiss 与文案 role（与 ghostty-host-copy 对齐）。 */
export type TerminalEndRole = "shell" | "agent" | "task" | "taskOutput";

/**
 * 面板终态快照（PR1 先落类型与 tab 派生；store / 广播见后续 PR）。
 * shell 默认不进 EndState（any-key 关窗）。
 */
export interface TerminalEndState {
  agentId?: AgentKind;
  /** 仅内存；是否已 inject 退出文案 */
  bufferInjected?: boolean;
  dismissMode: "any-key" | "explicit";
  exitCode?: number;
  finishedAt: number;
  panelId: string;
  retainPanel: true;
  role: Exclude<TerminalEndRole, "shell">;
  runtimeMs?: number;
  tab: PanelTabChrome;
}

/** agent 干净退出：code 0 或尚未拿到码（process-closed 先到）。 */
export function isAgentCleanExit(exitCode: number | undefined): boolean {
  return exitCode === undefined || exitCode === 0;
}

/**
 * Agent 会话结束 → tab state。
 * 干净退出返回 `undefined`（调用方应剥掉 state，禁止 succeeded）。
 * 非 0 → failed。
 */
export function buildAgentEndTabState(
  exitCode: number | undefined
): PanelTabState | undefined {
  if (isAgentCleanExit(exitCode)) {
    return;
  }
  return {
    colorToken: "destructive",
    label: `Exited ${String(exitCode)}`,
    status: "failed",
  };
}

/** 从现有 chrome 去掉 status 指示器（保留 icon / title）。 */
export function stripPanelTabChromeState(
  tab: PanelTabChrome | undefined
): PanelTabChrome | undefined {
  if (!tab?.state) {
    return tab;
  }
  const { state: _drop, ...rest } = tab;
  if (Object.keys(rest).length === 0) {
    return;
  }
  return normalizePanelTabChromeInput(rest) ?? rest;
}

/**
 * 将 agent 退出语义应用到当前 tab chrome。
 * 干净退出：剥 state；失败：merge failed state。
 */
export function applyAgentEndTabChrome(
  current: PanelTabChrome | undefined,
  exitCode: number | undefined
): PanelTabChrome | undefined {
  const endState = buildAgentEndTabState(exitCode);
  if (!endState) {
    return stripPanelTabChromeState(current);
  }
  const patch: PanelTabChrome = { state: endState };
  const next = {
    ...(current ?? {}),
    ...patch,
    state: { ...(current?.state ?? {}), ...endState },
  };
  return normalizePanelTabChromeInput(next) ?? next;
}

/**
 * 结果查看 base tab：已退出且干净时剥 success/running state。
 * 供 renderer 在 merge 前清洗历史 session.tab。
 */
export function tabChromeForAgentEndBase(
  tab: PanelTabChrome | undefined,
  options: {
    exitCode?: number | undefined;
    exited: boolean;
  }
): PanelTabChrome | undefined {
  if (!options.exited) {
    return tab;
  }
  if (!isAgentCleanExit(options.exitCode)) {
    return tab;
  }
  return stripPanelTabChromeState(tab);
}

/**
 * Agent 结果态 overlay（FA 清空后补 icon）。
 * 干净退出不写 state；失败写 failed。
 */
export function agentEndResultTabChrome(
  agentId: AgentKind,
  options?: {
    exitCode?: number | undefined;
    exited?: boolean | undefined;
    title?: string | null | undefined;
  }
): PanelTabChrome {
  const title = options?.title?.trim();
  const exited = options?.exited === true;
  const endState =
    exited && !isAgentCleanExit(options?.exitCode)
      ? buildAgentEndTabState(options?.exitCode)
      : undefined;
  return {
    icon: { id: agentTabIconId(agentId) },
    ...(title ? { title } : {}),
    ...(endState ? { state: endState } : {}),
  };
}

/** 历史磁盘：干净退出的 agent 是否仍带着 success 绿勾。 */
export function isLegacyAgentSuccessTab(
  tab: PanelTabChrome | undefined,
  agent: { exitCode?: number | undefined; status: string } | undefined | null
): boolean {
  if (agent?.status !== "exited" || !tab?.state) {
    return false;
  }
  if (!isAgentCleanExit(agent.exitCode)) {
    return false;
  }
  return tab.state.status === "succeeded" || tab.state.colorToken === "success";
}

/**
 * 若历史 agent 干净退出仍带 success tab，返回剥掉 state 后的 tab；否则原样返回。
 * 调用方负责写回 panel（避免泛型 + exactOptionalPropertyTypes 冲突）。
 */
export function stripLegacyAgentSuccessTab(
  tab: PanelTabChrome | undefined,
  agent: { exitCode?: number | undefined; status: string } | undefined | null
): PanelTabChrome | undefined {
  if (!isLegacyAgentSuccessTab(tab, agent)) {
    return tab;
  }
  return stripPanelTabChromeState(tab);
}

/**
 * Task 退出 → tab state（任务成功语义保留 succeeded 绿勾）。
 */
export function buildTaskEndTabState(
  status: Extract<TaskRunNodeStatus, "succeeded" | "failed" | "cancelled">,
  exitCode?: number
): PanelTabState {
  return taskRunTabState(status, exitCode);
}

export function taskEndTabStatusFromExit(args: {
  code?: number | undefined;
  reason: "user" | "process" | "restore" | string;
}): {
  status: Extract<TaskRunNodeStatus, "succeeded" | "failed" | "cancelled">;
  exitCode?: number;
} {
  if (args.reason === "user") {
    return { status: "cancelled" };
  }
  if (args.code === 0) {
    return { status: "succeeded", exitCode: 0 };
  }
  return {
    status: "failed",
    ...(args.code === undefined ? {} : { exitCode: args.code }),
  };
}

/** EndState 角色默认是否保留 panel（shell 不进 EndState）。 */
export function retainPanelForEndRole(role: TerminalEndRole): boolean {
  return role === "agent" || role === "task" || role === "taskOutput";
}

/** 供测试与治理：agent 终态 tab 是否非法带了 success。 */
export function agentEndTabHasForbiddenSuccess(
  tab: PanelTabChrome | undefined
): boolean {
  if (!tab?.state) {
    return false;
  }
  return tab.state.status === "succeeded" || tab.state.colorToken === "success";
}

/**
 * 物化 agent 结果查看终态（唯一推荐构造入口）。
 * 干净退出 tab 无 status；失败带 failed。
 */
export function materializeAgentEndState(args: {
  agentId: AgentKind;
  exitCode?: number | undefined;
  finishedAt?: number | undefined;
  panelId: string;
  runtimeMs?: number | undefined;
  title?: string | null | undefined;
}): TerminalEndState {
  const tab = agentEndResultTabChrome(args.agentId, {
    exitCode: args.exitCode,
    exited: true,
    title: args.title,
  });
  return {
    agentId: args.agentId,
    dismissMode: "explicit",
    ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
    finishedAt: args.finishedAt ?? Date.now(),
    panelId: args.panelId,
    retainPanel: true,
    role: "agent",
    ...(args.runtimeMs === undefined ? {} : { runtimeMs: args.runtimeMs }),
    tab,
  };
}

/**
 * 物化 task / taskOutput 结果查看终态（允许 success 绿勾）。
 * shell 不进 EndState。
 */
export function materializeTaskEndState(args: {
  exitCode: number;
  finishedAt?: number | undefined;
  panelId: string;
  role: "task" | "taskOutput";
  runtimeMs?: number | undefined;
  title?: string | null | undefined;
}): TerminalEndState {
  const nodeStatus = args.exitCode === 0 ? "succeeded" : "failed";
  const title = args.title?.trim();
  return {
    dismissMode: "explicit",
    exitCode: args.exitCode,
    finishedAt: args.finishedAt ?? Date.now(),
    panelId: args.panelId,
    retainPanel: true,
    role: args.role,
    ...(args.runtimeMs === undefined ? {} : { runtimeMs: args.runtimeMs }),
    tab: {
      ...(title ? { title } : {}),
      state: buildTaskEndTabState(nodeStatus, args.exitCode),
    },
  };
}

/**
 * 合并终态：同 panel 已存在时只允许补 exitCode / runtimeMs / bufferInjected / failed tab。
 * 禁止把 agent clean 写成 succeeded。
 */
export function mergeTerminalEndState(
  prev: TerminalEndState | undefined,
  next: TerminalEndState
): TerminalEndState {
  if (!prev || prev.panelId !== next.panelId) {
    return forbidAgentSuccess(next);
  }
  if (prev.role !== next.role && next.role === "agent") {
    return forbidAgentSuccess(next);
  }
  const exitCode = next.exitCode ?? prev.exitCode;
  const agentId = next.agentId ?? prev.agentId;
  const tab =
    next.role === "agent" && agentId
      ? agentEndResultTabChrome(agentId, {
          exitCode,
          exited: true,
          title: next.tab.title ?? prev.tab.title,
        })
      : (next.tab ?? prev.tab);
  const merged: TerminalEndState = {
    ...prev,
    ...next,
    finishedAt: next.finishedAt || prev.finishedAt,
    tab,
  };
  if (exitCode !== undefined) {
    merged.exitCode = exitCode;
  }
  const bufferInjected = next.bufferInjected ?? prev.bufferInjected;
  if (bufferInjected !== undefined) {
    merged.bufferInjected = bufferInjected;
  }
  const runtimeMs = next.runtimeMs ?? prev.runtimeMs;
  if (runtimeMs !== undefined) {
    merged.runtimeMs = runtimeMs;
  }
  return forbidAgentSuccess(merged);
}

function forbidAgentSuccess(state: TerminalEndState): TerminalEndState {
  if (state.role !== "agent" || !agentEndTabHasForbiddenSuccess(state.tab)) {
    return state;
  }
  return {
    ...state,
    tab: stripPanelTabChromeState(state.tab) ?? {
      icon: state.tab.icon,
      title: state.tab.title,
    },
  };
}

/**
 * 结果面板是否应保留（shared 谓词；main/renderer 对齐）。
 * shell 永不因本函数为 true（除非 task/agent 证据）。
 */
export function shouldRetainTerminalResultPanel(hints: {
  hasAgentActivity: boolean;
  hasAgentSession: boolean;
  hasEndState: boolean;
  hasTaskOwnership: boolean;
  hasTaskParams: boolean;
  isTaskOutputPanel: boolean;
}): boolean {
  return (
    hints.isTaskOutputPanel ||
    hints.hasTaskParams ||
    hints.hasEndState ||
    hints.hasAgentActivity ||
    hints.hasAgentSession ||
    hints.hasTaskOwnership
  );
}
