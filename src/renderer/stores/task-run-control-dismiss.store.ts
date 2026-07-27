import { create } from "zustand";

/**
 * 任务控制条用户 dismiss（点停止成功 / 点关闭收起）。
 * 与 TaskRuns 快照分离：不改变 run 状态，只控制控制条是否在场。
 */
interface TaskRunControlDismissState {
  clearForTests(): void;
  dismiss(runId: string): void;
  dismissed: Readonly<Record<string, true>>;
  isDismissed(runId: string): boolean;
  undismiss(runId: string): void;
}

export const useTaskRunControlDismissStore = create<TaskRunControlDismissState>(
  (set, get) => ({
    dismissed: {},
    dismiss(runId) {
      if (get().dismissed[runId]) {
        return;
      }
      set((state) => ({
        dismissed: { ...state.dismissed, [runId]: true },
      }));
    },
    isDismissed(runId) {
      return Boolean(get().dismissed[runId]);
    },
    undismiss(runId) {
      if (!get().dismissed[runId]) {
        return;
      }
      set((state) => {
        const { [runId]: _removed, ...rest } = state.dismissed;
        return { dismissed: rest };
      });
    },
    clearForTests() {
      set({ dismissed: {} });
    },
  })
);
