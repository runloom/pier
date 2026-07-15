import { useEffect, useRef } from "react";
import { scheduleTaskOutputPanelSync } from "@/lib/actions/task-output-sync.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

/** workspace ready 与 TaskRuns 变更后统一维护 Task Output 逻辑视图。 */
export function TaskOutputSyncBridge(): null {
  const snapshot = useTaskRunsStore((state) => state.snapshot);
  const initialized = useTaskRunsStore((state) => state.initialized);
  const api = useWorkspaceStore((state) => state.api);
  const versionRef = useRef(-1);
  const apiReadyRef = useRef(false);

  useEffect(() => {
    if (!(api && initialized)) {
      return;
    }
    const workspaceBecameReady = !apiReadyRef.current;
    const snapshotChanged = snapshot.version !== versionRef.current;
    apiReadyRef.current = true;
    versionRef.current = snapshot.version;
    if (workspaceBecameReady || snapshotChanged) {
      const syncPanels = async () => {
        await scheduleTaskOutputPanelSync();
      };
      syncPanels();
    }
  }, [api, initialized, snapshot]);

  return null;
}
