import { create } from "zustand";

interface TaskRunSelectionState {
  selectedRunIdsByPanel: Record<string, string>;
  selectPanelRun(panelId: string, runId: string | null): void;
}

export const useTaskRunSelectionStore = create<TaskRunSelectionState>(
  (set) => ({
    selectedRunIdsByPanel: {},
    selectPanelRun: (panelId, runId) => {
      set((state) => {
        if (runId) {
          if (state.selectedRunIdsByPanel[panelId] === runId) {
            return state;
          }
          return {
            selectedRunIdsByPanel: {
              ...state.selectedRunIdsByPanel,
              [panelId]: runId,
            },
          };
        }
        if (!(panelId in state.selectedRunIdsByPanel)) {
          return state;
        }
        const { [panelId]: _removed, ...selectedRunIdsByPanel } =
          state.selectedRunIdsByPanel;
        return { selectedRunIdsByPanel };
      });
    },
  })
);

export function selectedTaskRunIdForPanel(panelId: string): string | null {
  return (
    useTaskRunSelectionStore.getState().selectedRunIdsByPanel[panelId] ?? null
  );
}

export function clearTaskRunSelectionForPanel(panelId: string): void {
  useTaskRunSelectionStore.getState().selectPanelRun(panelId, null);
}
