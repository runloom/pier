import type { DockviewReadyEvent } from "dockview-react";

type WorkspacePanel = DockviewReadyEvent["api"]["panels"][number];

/** dockview 的 onDidLayoutChange 不包含 updateParameters，需单独汇入保存入口。 */
export function subscribeWorkspacePanelParameterChanges(
  api: DockviewReadyEvent["api"],
  onChange: () => void
): void {
  const subscriptions = new Map<string, { dispose(): void }>();
  const subscribe = (panel: WorkspacePanel) => {
    subscriptions.get(panel.id)?.dispose();
    subscriptions.set(panel.id, panel.api.onDidParametersChange(onChange));
  };

  for (const panel of api.panels) {
    subscribe(panel);
  }
  api.onDidAddPanel(subscribe);
  api.onDidRemovePanel((panel) => {
    subscriptions.get(panel.id)?.dispose();
    subscriptions.delete(panel.id);
  });
}

export function createWorkspaceLayoutSaveScheduler({
  delayMs,
  onError,
  save,
}: {
  delayMs: number;
  onError(error: unknown): void;
  save(): Promise<void>;
}): { cancelPending(): boolean; schedule(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    cancelPending: () => {
      if (!timer) {
        return false;
      }
      clearTimeout(timer);
      timer = null;
      return true;
    },
    schedule: () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        save().catch(onError);
      }, delayMs);
    },
  };
}
