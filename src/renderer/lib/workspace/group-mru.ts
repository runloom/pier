/**
 * 本窗 dockview 组级最近使用队列（不落盘）。
 * 队头是当前组；关组接手必须在任何 setActive 之前快照。
 */

export interface WorkspaceGroupMruApi {
  activeGroup?: { id?: string } | null;
  onDidActiveGroupChange?: (
    listener: (group: { id?: string } | undefined) => void
  ) => { dispose: () => void };
  onDidRemoveGroup?: (listener: (group: { id?: string }) => void) => {
    dispose: () => void;
  };
}

const mruIds: string[] = [];

export function groupMruIds(): readonly string[] {
  return [...mruIds];
}

export function touchGroup(id: string): void {
  if (!id) {
    return;
  }
  const index = mruIds.indexOf(id);
  if (index >= 0) {
    mruIds.splice(index, 1);
  }
  mruIds.unshift(id);
}

export function forgetGroup(id: string): void {
  const index = mruIds.indexOf(id);
  if (index >= 0) {
    mruIds.splice(index, 1);
  }
}

export function resetGroupMru(): void {
  mruIds.length = 0;
}

const noopDispose = { dispose: () => undefined };

function asDisposable(value: { dispose: () => void } | null | undefined): {
  dispose: () => void;
} {
  return value ?? noopDispose;
}

export function attachWorkspaceGroupMru(api: WorkspaceGroupMruApi): () => void {
  resetGroupMru();
  const seedId = api.activeGroup?.id;
  if (seedId) {
    touchGroup(seedId);
  }

  const activeSub = asDisposable(
    typeof api.onDidActiveGroupChange === "function"
      ? api.onDidActiveGroupChange((group) => {
          const id = group?.id;
          if (id) {
            touchGroup(id);
          }
        })
      : undefined
  );
  const removedSub = asDisposable(
    typeof api.onDidRemoveGroup === "function"
      ? api.onDidRemoveGroup((group) => {
          const id = group?.id;
          if (id) {
            forgetGroup(id);
          }
        })
      : undefined
  );

  return () => {
    activeSub.dispose();
    removedSub.dispose();
    resetGroupMru();
  };
}
