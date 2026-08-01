import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  materializeAgentEndState,
  materializeTaskEndState,
  mergeTerminalEndState,
  type TerminalEndState,
} from "@shared/contracts/terminal/end-state.ts";
import { create } from "zustand";

interface TerminalEndStateStore {
  clear: (panelId: string) => void;
  ends: Record<string, TerminalEndState>;
  markBufferInjected: (panelId: string) => void;
  /**
   * Upsert agent end state (child-exited / session hydrate / broadcast).
   * CAS-merges exitCode; forbids agent success chrome.
   */
  upsertAgentEnd: (args: {
    agentId: AgentKind;
    exitCode?: number | undefined;
    finishedAt?: number | undefined;
    panelId: string;
    runtimeMs?: number | undefined;
    title?: string | null | undefined;
  }) => void;
  upsertEnd: (end: TerminalEndState) => void;
  upsertTaskEnd: (args: {
    exitCode: number;
    finishedAt?: number | undefined;
    panelId: string;
    role: "task" | "taskOutput";
    runtimeMs?: number | undefined;
    title?: string | null | undefined;
  }) => void;
}

/**
 * 终端结果查看态镜像 — 唯一 renderer 权威（替代模块 latch Map）。
 * 写入：child-exited / session 水合 / main 广播。
 * 读取：tab chrome、retain、inject once、keyboard park。
 */
export const useTerminalEndStateStore = create<TerminalEndStateStore>(
  (set, get) => ({
    ends: {},
    upsertEnd: (end) => {
      const prev = get().ends[end.panelId];
      const merged = mergeTerminalEndState(prev, end);
      set({
        ends: { ...get().ends, [end.panelId]: merged },
      });
    },
    upsertAgentEnd: (args) => {
      get().upsertEnd(
        materializeAgentEndState({
          agentId: args.agentId,
          ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
          ...(args.finishedAt === undefined
            ? {}
            : { finishedAt: args.finishedAt }),
          panelId: args.panelId,
          ...(args.runtimeMs === undefined
            ? {}
            : { runtimeMs: args.runtimeMs }),
          ...(args.title == null ? {} : { title: args.title }),
        })
      );
    },
    upsertTaskEnd: (args) => {
      get().upsertEnd(
        materializeTaskEndState({
          exitCode: args.exitCode,
          ...(args.finishedAt === undefined
            ? {}
            : { finishedAt: args.finishedAt }),
          panelId: args.panelId,
          role: args.role,
          ...(args.runtimeMs === undefined
            ? {}
            : { runtimeMs: args.runtimeMs }),
          ...(args.title == null ? {} : { title: args.title }),
        })
      );
    },
    markBufferInjected: (panelId) => {
      const prev = get().ends[panelId];
      if (!prev || prev.bufferInjected) {
        return;
      }
      set({
        ends: {
          ...get().ends,
          [panelId]: { ...prev, bufferInjected: true },
        },
      });
    },
    clear: (panelId) => {
      if (!(panelId in get().ends)) {
        return;
      }
      const { [panelId]: _drop, ...rest } = get().ends;
      set({ ends: rest });
    },
  })
);

export function terminalEndStateForPanel(
  panelId: string
): TerminalEndState | undefined {
  return useTerminalEndStateStore.getState().ends[panelId];
}

/** test helper */
export function resetTerminalEndStateStoreForTests(): void {
  useTerminalEndStateStore.setState({ ends: {} });
}
