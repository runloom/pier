import type { PanelContext, PanelTabChrome } from "@shared/contracts/panel.ts";
import type { TaskPanelMetadata } from "@shared/contracts/tasks.ts";
import { create } from "zustand";

export interface TerminalRelaunchRequest {
  context?: PanelContext | undefined;
  initialInput?: string | undefined;
  launchId: string;
  panelId: string;
  sequence: number;
  tab?: PanelTabChrome | undefined;
  task?: TaskPanelMetadata | undefined;
}

interface TerminalRelaunchState {
  clearTerminalRelaunchRequest: (panelId: string) => void;
  requests: Record<string, TerminalRelaunchRequest>;
  requestTerminalRelaunch: (
    request: Omit<TerminalRelaunchRequest, "sequence">
  ) => void;
  sequence: number;
}

const useTerminalRelaunchStore = create<TerminalRelaunchState>((set) => ({
  requests: {},
  sequence: 0,
  clearTerminalRelaunchRequest: (panelId) => {
    set((state) => {
      if (!(panelId in state.requests)) {
        return state;
      }
      const { [panelId]: _removed, ...requests } = state.requests;
      return { requests };
    });
  },
  requestTerminalRelaunch: (request) => {
    set((state) => {
      const sequence = state.sequence + 1;
      return {
        requests: {
          ...state.requests,
          [request.panelId]: { ...request, sequence },
        },
        sequence,
      };
    });
  },
}));

export function clearTerminalRelaunchRequest(panelId: string): void {
  useTerminalRelaunchStore.getState().clearTerminalRelaunchRequest(panelId);
}

export function requestTerminalRelaunch(
  request: Omit<TerminalRelaunchRequest, "sequence">
): void {
  useTerminalRelaunchStore.getState().requestTerminalRelaunch(request);
}

export function useTerminalRelaunchRequest(
  panelId: string
): TerminalRelaunchRequest | null {
  return useTerminalRelaunchStore((state) => state.requests[panelId] ?? null);
}
