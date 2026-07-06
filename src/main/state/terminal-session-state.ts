/** Terminal session state persistence: panel metadata per window + terminal id. */
import { taskTabStateForActivityStatus } from "@shared/contracts/foreground-activity.ts";
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
import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import {
  type TerminalPanelSession,
  terminalAgentPanelMetadataSchema,
} from "./terminal-session-state-schemas.ts";
import {
  emptyWindowSession,
  ensureTerminalSessionStore,
} from "./terminal-session-store.ts";

export type { TerminalPanelSession } from "./terminal-session-state-schemas.ts";

const ensureStore = ensureTerminalSessionStore;

export async function readTerminalPanelSession(
  windowId: string,
  panelId: string
): Promise<TerminalPanelSession | null> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return null;
  }
  const s = await ensureStore();
  return s.get().windows[windowId]?.panels[panelId] ?? null;
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

function agentExitTabPatch(
  exitCode: number | undefined
): Partial<PanelTabChrome> {
  const succeeded = exitCode === undefined || exitCode === 0;
  return {
    state: succeeded
      ? { colorToken: "success", label: "Exited", status: "succeeded" }
      : {
          colorToken: "destructive",
          label: `Exited ${exitCode}`,
          status: "failed",
        },
  };
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
    windowState.panels[panelId] = {
      ...current,
      agent: parsed.data,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

export async function updateTerminalPanelAgentResume(
  windowId: string,
  panelId: string,
  resume: NonNullable<TerminalAgentPanelMetadata["resume"]> & {
    agentId: TerminalAgentPanelMetadata["agentId"];
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
    if (
      !(
        windowState &&
        current?.agent &&
        current.agent.status === "running" &&
        current.agent.agentId === resume.agentId
      )
    ) {
      return state;
    }
    const nextAgent = {
      ...current.agent,
      resume: {
        capturedAt: resume.capturedAt,
        sessionId: resume.sessionId,
        source: resume.source,
      },
    };
    const parsed = terminalAgentPanelMetadataSchema.safeParse(nextAgent);
    if (!parsed.success) {
      return state;
    }
    windowState.panels[panelId] = {
      ...current,
      agent: parsed.data,
      updatedAt: new Date().toISOString(),
    };
    patched = true;
    return state;
  });
  return patched;
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
            tab: mergePanelTabChrome(current.tab, agentExitTabPatch(exitCode)),
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
    if (!(windowState && current?.task && current.task.status === "running")) {
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
/** App 启动孤儿清算：上个进程的 running task 统一落成 cancelled。 */
export async function reconcileOrphanedRunningTasks(
  now: () => number = Date.now
): Promise<number> {
  const s = await ensureStore();
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
            state: taskTabStateForActivityStatus("cancelled"),
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

export async function flushTerminalSessionState(): Promise<void> {
  const s = await ensureStore();
  await s.flush();
}
