import type { TaskLaunchPlan, TaskPanelRef } from "@shared/contracts/tasks.ts";

function panelRefKey(panelId: string, windowId?: string | undefined): string {
  return windowId ? `${windowId}\0${panelId}` : panelId;
}

function taskPanelRef(ref: TaskPanelRef): TaskPanelRef {
  return {
    panelId: ref.panelId,
    ...(ref.windowId ? { windowId: ref.windowId } : {}),
  };
}

export function createTaskPanelReuseRegistry() {
  const panelByKey = new Map<string, TaskPanelRef>();
  const keysByPanel = new Map<string, Set<string>>();

  return {
    forget(panelId: string, windowId?: string | undefined): void {
      const panelKey = panelRefKey(panelId, windowId);
      const keys = keysByPanel.get(panelKey);
      if (!keys) {
        return;
      }
      keysByPanel.delete(panelKey);
      for (const key of keys) {
        const ref = panelByKey.get(key);
        if (ref && panelRefKey(ref.panelId, ref.windowId) === panelKey) {
          panelByKey.delete(key);
        }
      }
    },

    remember(panelId: string, windowId: string | undefined, key: string): void {
      const panelKey = panelRefKey(panelId, windowId);
      const existing = panelByKey.get(key);
      if (existing) {
        const existingPanelKey = panelRefKey(
          existing.panelId,
          existing.windowId
        );
        if (existingPanelKey !== panelKey) {
          const existingKeys = keysByPanel.get(existingPanelKey);
          existingKeys?.delete(key);
          if (existingKeys?.size === 0) {
            keysByPanel.delete(existingPanelKey);
          }
        }
      }
      panelByKey.set(key, {
        panelId,
        ...(windowId ? { windowId } : {}),
      });
      const keys = keysByPanel.get(panelKey) ?? new Set<string>();
      keys.add(key);
      keysByPanel.set(panelKey, keys);
    },

    reusablePanelsForLaunches(
      launches: readonly TaskLaunchPlan[],
      keyForLaunch: (launch: TaskLaunchPlan) => string
    ): Record<string, TaskPanelRef> | undefined {
      const reusablePanels: Record<string, TaskPanelRef> = {};
      for (const launch of launches) {
        const ref = panelByKey.get(keyForLaunch(launch));
        if (ref) {
          reusablePanels[launch.taskId] = taskPanelRef(ref);
        }
      }
      return Object.keys(reusablePanels).length > 0
        ? reusablePanels
        : undefined;
    },
  };
}
