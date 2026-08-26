/** Terminal session state persistence: panel metadata per window + terminal id. */

import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelTabChrome,
} from "@shared/contracts/panel.ts";
import {
  type TaskExitReason,
  type TaskExitSource,
  type TaskPanelMetadata,
  type TaskPanelStatus,
  taskPanelMetadataSchema,
} from "@shared/contracts/tasks.ts";
import {
  applyAgentEndTabChrome,
  stripLegacyAgentSuccessTab,
} from "@shared/contracts/terminal/end-state.ts";
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import {
  clearPendingAgentResume,
  mergePendingResumeIntoAgent,
  seedDiskPendingResume,
} from "./terminal-session-agent-resume.ts";
import { withHealedHostTeardownSession } from "./terminal-session-heal.ts";
import {
  type TerminalPanelSession,
  terminalAgentPanelMetadataSchema,
} from "./terminal-session-state-schemas.ts";
import {
  emptyWindowSession,
  ensureTerminalSessionStore,
} from "./terminal-session-store.ts";

export {
  clearPendingAgentResume,
  clearPendingAgentResumesForTests,
  clearPendingAgentResumesForWindow,
  getPendingAgentResume,
  peekPendingAgentResumeForTests,
  rekeyPendingAgentResume,
  updateTerminalPanelAgentResume,
} from "./terminal-session-agent-resume.ts";
export {
  type DetachAgentsOptions,
  detachAgentsForWindow,
  detachAgentsForWindowSync,
} from "./terminal-session-detach-agents.ts";
export { ensureTerminalPanelSession } from "./terminal-session-ensure.ts";
export { recordTerminalPanelAgentSpawnGeneration } from "./terminal-session-heal.ts";
export {
  migrateLegacyAgentSuccessTabs,
  reconcileOrphanedRunningTasks,
} from "./terminal-session-reconcile.ts";
export { retainTerminalPanelSessions } from "./terminal-session-retain-panels.ts";
export type { TerminalPanelSession } from "./terminal-session-state-schemas.ts";
export {
  listRunningAgentPanelIds,
  peekTerminalPanelAgent,
  peekTerminalPanelContext,
} from "./terminal-session-store.ts";

const ensureStore = ensureTerminalSessionStore;

export async function readTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<TerminalPanelSession | null> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  const s = await ensureStore();
  const panel = s.get().windows[windowId]?.panels[panelId] ?? null;
  if (!panel) {
    return null;
  }
  const healed = withHealedHostTeardownSession(panel);
  // Historical agentExitTabPatch wrote success on clean exit — strip on read.
  const tab = stripLegacyAgentSuccessTab(healed.tab, healed.agent);
  if (tab === healed.tab) {
    return healed;
  }
  if (tab === undefined) {
    const { tab: _drop, ...rest } = healed;
    return rest;
  }
  return { ...healed, tab };
}

function isRestorableTitle(title: string): boolean {
  return title.trim().length > 0;
}

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

/** Agent 会话结束 tab：shared applyAgentEndTabChrome（干净退出无 success）。 */
function tabChromeAfterAgentExit(
  current: PanelTabChrome | undefined,
  exitCode: number | undefined
): PanelTabChrome | undefined {
  return applyAgentEndTabChrome(current, exitCode);
}

export async function updateTerminalPanelContext(
  windowId: string,
  panelId: string,
  context: PanelContext
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      context,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelTab(
  windowId: string,
  panelId: string,
  tab: PanelTabChrome
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const normalized = normalizePanelTabChromeInput(tab);
  if (!normalized) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      tab: normalized,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelTask(
  windowId: string,
  panelId: string,
  task: TaskPanelMetadata
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const parsed = taskPanelMetadataSchema.safeParse(task);
  if (!parsed.success) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    windowState.panels[panelId] = {
      ...current,
      task: parsed.data,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelAgent(
  windowId: string,
  panelId: string,
  agent: TerminalAgentPanelMetadata
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const parsed = terminalAgentPanelMetadataSchema.safeParse(agent);
  if (!parsed.success) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId] ?? {};
    if (current.pendingResume) {
      seedDiskPendingResume(windowId, panelId, current.pendingResume);
    }
    const nextAgent = mergePendingResumeIntoAgent(
      parsed.data,
      windowId,
      panelId
    );
    const { pendingResume: _pending, ...rest } = current;
    windowState.panels[panelId] = {
      ...rest,
      agent: nextAgent,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function patchTerminalPanelAgentStatus(
  windowId: string,
  panelId: string,
  patch: {
    exitCode?: number | undefined;
    finishedAt?: number | undefined;
    status: TerminalAgentPanelMetadata["status"];
  }
): Promise<boolean> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return false;
  }
  let patched = false;
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current?.agent)) {
      return state;
    }
    const canPatchExited =
      current.agent.status === "exited" &&
      patch.status === "exited" &&
      (patch.exitCode !== undefined || patch.finishedAt !== undefined);
    if (!(current.agent.status === "running" || canPatchExited)) {
      return state;
    }
    if (
      patch.status === "exited" &&
      current.agent.restore?.cause === "host-teardown"
    ) {
      return state;
    }
    const exitCode = patch.exitCode ?? current.agent.exitCode;
    const nextAgent = {
      ...current.agent,
      status: patch.status,
      ...(patch.exitCode === undefined ? {} : { exitCode: patch.exitCode }),
      ...(patch.finishedAt === undefined
        ? {}
        : { finishedAt: patch.finishedAt }),
    };
    const parsed = terminalAgentPanelMetadataSchema.safeParse(nextAgent);
    if (!parsed.success) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      agent: parsed.data,
      ...(patch.status === "exited"
        ? {
            tab: tabChromeAfterAgentExit(current.tab, exitCode),
          }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    patched = true;
    return state;
  });
  return patched;
}

export async function clearTerminalPanelAgent(
  windowId: string,
  panelId: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  clearPendingAgentResume(windowId, panelId);
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current?.agent)) {
      return state;
    }
    const { agent: _agent, ...nextPanel } = current;
    windowState.panels[panelId] = {
      ...nextPanel,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function patchTerminalPanelTaskStatus(
  windowId: string,
  panelId: string,
  expectedRunId: string,
  patch: {
    exitCode?: number | undefined;
    exitReason?: TaskExitReason | undefined;
    exitSource?: TaskExitSource | undefined;
    finishedAt?: number | undefined;
    status: TaskPanelStatus;
  }
): Promise<boolean> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return false;
  }
  let patched = false;
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current?.task?.runId === expectedRunId)) {
      return state;
    }
    if (current.task.status !== "running") {
      if (current.task.status === patch.status) {
        patched = true;
      }
      return state;
    }
    const nextTask = {
      ...current.task,
      status: patch.status,
      ...(patch.exitCode === undefined ? {} : { exitCode: patch.exitCode }),
      ...(patch.exitReason === undefined
        ? {}
        : { exitReason: patch.exitReason }),
      ...(patch.exitSource === undefined
        ? {}
        : { exitSource: patch.exitSource }),
      ...(patch.finishedAt === undefined
        ? {}
        : { finishedAt: patch.finishedAt }),
    };
    const parsed = taskPanelMetadataSchema.safeParse(nextTask);
    if (!parsed.success) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      task: parsed.data,
      updatedAt: new Date().toISOString(),
    };
    patched = true;
    return state;
  });
  return patched;
}

export async function patchTerminalPanelTab(
  windowId: string,
  panelId: string,
  tabPatch: Partial<PanelTabChrome>
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current)) {
      return state;
    }
    const tab = mergePanelTabChrome(current.tab, tabPatch);
    if (!tab) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      tab,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelTitle(
  windowId: string,
  panelId: string,
  title: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  if (!isRestorableTitle(title)) {
    return;
  }
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId] ?? emptyWindowSession();
    state.windows[windowId] = windowState;
    const current = windowState.panels[panelId];
    if (!current) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      title,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function removeTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  clearPendingAgentResume(windowId, panelId);
  const s = await ensureStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    if (!windowState?.panels[panelId]) {
      return state;
    }
    delete windowState.panels[panelId];
    if (Object.keys(windowState.panels).length === 0) {
      delete state.windows[windowId];
    }
    return state;
  });
}
export async function flushTerminalSessionState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
