import type { TaskBackgroundRunSnapshot } from "@shared/contracts/tasks.ts";
import { create } from "zustand";

export type TerminalTaskHistoryStatus = TaskBackgroundRunSnapshot["status"];

export interface TerminalTaskHistoryEntry {
  detail?: string;
  firstStartedAt: number;
  label: string;
  panelId: string;
  projectRootPath: string;
  runId?: string;
  status: TerminalTaskHistoryStatus;
  taskId: string;
  updatedAt: number;
}

interface RememberTerminalTaskRunArgs {
  detail?: string;
  label: string;
  panelId: string;
  projectRootPath: string;
  runId?: string;
  status?: TerminalTaskHistoryStatus;
  taskId: string;
}

interface TerminalTaskHistoryState {
  panels: Record<string, Record<string, TerminalTaskHistoryEntry>>;
  record(args: RememberTerminalTaskRunArgs): void;
  version: number;
}

export const useTerminalTaskHistoryStore = create<TerminalTaskHistoryState>(
  (set) => ({
    panels: {},
    record: (args) =>
      set((state) => {
        const now = Date.now();
        const panelTasks = state.panels[args.panelId] ?? {};
        const existing = panelTasks[args.taskId];
        return {
          panels: {
            ...state.panels,
            [args.panelId]: {
              ...panelTasks,
              [args.taskId]: {
                firstStartedAt: existing?.firstStartedAt ?? now,
                label: args.label,
                panelId: args.panelId,
                projectRootPath: args.projectRootPath,
                status: args.status ?? "running",
                taskId: args.taskId,
                updatedAt: now,
                ...(args.detail ? { detail: args.detail } : {}),
                ...(args.runId ? { runId: args.runId } : {}),
              },
            },
          },
          version: state.version + 1,
        };
      }),
    version: 0,
  })
);

export function rememberTerminalTaskRun(
  args: RememberTerminalTaskRunArgs
): void {
  useTerminalTaskHistoryStore.getState().record(args);
}

export function terminalTaskHistoryEntries(
  panelId: string
): readonly TerminalTaskHistoryEntry[] {
  return Object.values(
    useTerminalTaskHistoryStore.getState().panels[panelId] ?? {}
  ).sort(
    (a, b) => b.updatedAt - a.updatedAt || a.taskId.localeCompare(b.taskId)
  );
}
