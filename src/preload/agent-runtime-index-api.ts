import type {
  AgentRuntimeFocusResult,
  AgentRuntimeIndexSnapshot,
  SortAgentIndexEntriesOptions,
} from "@shared/contracts/agent-runtime-index.ts";
import type { SystemNotificationUnavailableReason } from "@shared/contracts/notification.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

/**
 * Agent Runtime Index renderer API：
 * - `list()` 启动兜底
 * - `onChanged` 订阅本机快照推送（唯一增量路径，勿再挂 FA onChanged→list）
 * - `onFocusFeedback` 通知 click 等非 ok focus 结果（Task 5）
 * - `onAttentionDegraded` 系统通知不可用 → 标题栏降级提示
 */
export interface PierAgentRuntimeIndexAPI {
  focus: (agentRef: string) => Promise<AgentRuntimeFocusResult>;
  focusWaiting: (
    options?: SortAgentIndexEntriesOptions
  ) => Promise<AgentRuntimeFocusResult>;
  list: () => Promise<AgentRuntimeIndexSnapshot>;
  onAttentionDegraded: (
    cb: (payload: { reason: SystemNotificationUnavailableReason }) => void
  ) => () => void;
  onChanged: (cb: (snapshot: AgentRuntimeIndexSnapshot) => void) => () => void;
  onFocusFeedback: (
    cb: (result: AgentRuntimeFocusResult) => void
  ) => () => void;
}

export const agentRuntimeIndexApi: PierAgentRuntimeIndexAPI = {
  focus: (agentRef) =>
    ipcRenderer.invoke(PIER.AGENT_RUNTIME_INDEX_FOCUS, { agentRef }),
  focusWaiting: (options) =>
    ipcRenderer.invoke(PIER.AGENT_RUNTIME_INDEX_FOCUS_WAITING, options ?? {}),
  list: () => ipcRenderer.invoke(PIER.AGENT_RUNTIME_INDEX_LIST),
  onAttentionDegraded: (cb) => {
    const listener = (
      _event: unknown,
      payload: { reason: SystemNotificationUnavailableReason }
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.AGENT_ATTENTION_DEGRADED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.AGENT_ATTENTION_DEGRADED, listener);
    };
  },
  onChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: AgentRuntimeIndexSnapshot
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.AGENT_RUNTIME_INDEX_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.AGENT_RUNTIME_INDEX_CHANGED, listener);
    };
  },
  onFocusFeedback: (cb) => {
    const listener = (
      _event: unknown,
      payload: AgentRuntimeFocusResult
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(PIER_BROADCAST.AGENT_RUNTIME_FOCUS_FEEDBACK, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.AGENT_RUNTIME_FOCUS_FEEDBACK, listener);
    };
  },
};
