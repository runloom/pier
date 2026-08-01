/** Startup reconcile / migrate for terminal-session-state. */

import {
  normalizePanelTabChromeInput,
  type PanelTabChrome,
} from "@shared/contracts/panel.ts";
import {
  taskPanelMetadataSchema,
  taskRunTabState,
} from "@shared/contracts/tasks.ts";
import { stripLegacyAgentSuccessTab } from "@shared/contracts/terminal/end-state.ts";
import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

function mergePanelTabChrome(
  current: PanelTabChrome | undefined,
  patch: Partial<PanelTabChrome>
): PanelTabChrome | undefined {
  const normalizedPatch = normalizePanelTabChromeInput(patch);
  if (!normalizedPatch) {
    return current;
  }
  const next = {
    ...(current ?? {}),
    ...normalizedPatch,
    ...(normalizedPatch.badge
      ? { badge: { ...(current?.badge ?? {}), ...normalizedPatch.badge } }
      : {}),
    ...(normalizedPatch.icon
      ? { icon: { ...(current?.icon ?? {}), ...normalizedPatch.icon } }
      : {}),
    ...(normalizedPatch.state
      ? { state: { ...(current?.state ?? {}), ...normalizedPatch.state } }
      : {}),
    ...(normalizedPatch.tooltip
      ? {
          tooltip: {
            ...(current?.tooltip ?? {}),
            ...normalizedPatch.tooltip,
          },
        }
      : {}),
  };
  return normalizePanelTabChromeInput(next) ?? current;
}

/** App 启动孤儿清算：上个进程的 running task 统一落成 cancelled。 */
export async function reconcileOrphanedRunningTasks(
  now: () => number = Date.now
): Promise<number> {
  const s = await ensureTerminalSessionStore();
  let swept = 0;
  s.mutate((state) => {
    for (const windowState of Object.values(state.windows)) {
      for (const [panelId, panel] of Object.entries(windowState.panels)) {
        if (panel.task?.status !== "running") {
          continue;
        }
        const nextTask = taskPanelMetadataSchema.safeParse({
          ...panel.task,
          exitReason: "restore",
          exitSource: "restore",
          finishedAt: now(),
          status: "cancelled",
        });
        if (!nextTask.success) {
          continue;
        }
        windowState.panels[panelId] = {
          ...panel,
          tab: mergePanelTabChrome(panel.tab, {
            state: taskRunTabState("cancelled"),
          }),
          task: nextTask.data,
          updatedAt: new Date(now()).toISOString(),
        };
        swept += 1;
      }
    }
    return state;
  });
  return swept;
}

/**
 * 一次性写回清洗历史 agent 干净退出上的 success 绿勾。
 * 返回改写的 panel 数。
 */
export async function migrateLegacyAgentSuccessTabs(): Promise<number> {
  const s = await ensureTerminalSessionStore();
  let changed = 0;
  s.mutate((state) => {
    for (const windowState of Object.values(state.windows)) {
      for (const [panelId, panel] of Object.entries(windowState.panels)) {
        const tab = stripLegacyAgentSuccessTab(panel.tab, panel.agent);
        if (tab === panel.tab) {
          continue;
        }
        const { tab: _drop, ...rest } = panel;
        windowState.panels[panelId] = {
          ...rest,
          ...(tab === undefined ? {} : { tab }),
          updatedAt: new Date().toISOString(),
        };
        changed += 1;
      }
    }
    return state;
  });
  if (changed > 0) {
    await s.flush();
  }
  return changed;
}
