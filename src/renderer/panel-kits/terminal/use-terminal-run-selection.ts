import type { TaskRunControlEntry } from "@shared/contracts/tasks.ts";
import { useCallback, useEffect, useRef } from "react";
import { useTaskRunSelectionStore } from "@/stores/task-run-selection.store.ts";
import { isActiveTaskRunStatus } from "./use-terminal-runtime-control-presentation.ts";

export function useTerminalRunSelection(
  panelId: string,
  runs: readonly TaskRunControlEntry[]
): {
  selectedRunId: string | null;
  setSelectedRunId(runId: string | null): void;
} {
  const selectedRunId = useTaskRunSelectionStore(
    (state) => state.selectedRunIdsByPanel[panelId] ?? null
  );
  const selectPanelRun = useTaskRunSelectionStore(
    (state) => state.selectPanelRun
  );
  const setSelectedRunId = useCallback(
    (runId: string | null) => selectPanelRun(panelId, runId),
    [panelId, selectPanelRun]
  );
  const lastAutoSelectedActiveRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    const activeRunId = runs.find((candidate) =>
      isActiveTaskRunStatus(candidate.status)
    )?.runId;
    if (activeRunId && activeRunId !== lastAutoSelectedActiveRunIdRef.current) {
      lastAutoSelectedActiveRunIdRef.current = activeRunId;
      setSelectedRunId(activeRunId);
      return;
    }
    if (!activeRunId) {
      lastAutoSelectedActiveRunIdRef.current = null;
    }
    if (selectedRunId && runs.some((run) => run.runId === selectedRunId)) {
      return;
    }
    setSelectedRunId(runs[0]?.runId ?? null);
  }, [runs, selectedRunId, setSelectedRunId]);

  return { selectedRunId, setSelectedRunId };
}
