import type { TerminalAgentPanelMetadata } from "@shared/contracts/terminal.ts";
import {
  type TerminalPanelSession,
  terminalAgentPanelMetadataSchema,
} from "./terminal-session-state-schemas.ts";
import { ensureTerminalSessionStore } from "./terminal-session-store.ts";

function isCleanExitCode(exitCode: number | undefined): boolean {
  return exitCode === undefined || exitCode === 0;
}

/** In-memory view: host-killed exited rows look running so skipNativeCreate misses. */
export function healHostTeardownAgentOnRead(
  agent: TerminalAgentPanelMetadata | undefined
): TerminalAgentPanelMetadata | undefined {
  if (agent?.status !== "exited") {
    return agent;
  }
  const detachedAt = agent.restore?.detachedAt;
  if (detachedAt === undefined || !agent.resume?.sessionId) {
    return agent;
  }
  if (!isCleanExitCode(agent.exitCode)) {
    return agent;
  }
  const finishedAt = agent.finishedAt;
  if (finishedAt !== undefined && detachedAt > finishedAt) {
    return agent;
  }
  const { exitCode: _e, finishedAt: _f, ...rest } = agent;
  return {
    ...rest,
    restore: {
      ...agent.restore,
      cause: "host-teardown",
    },
    status: "running",
  };
}

function resumeFieldsFromPending(
  pending: NonNullable<TerminalPanelSession["pendingResume"]>
): NonNullable<TerminalAgentPanelMetadata["resume"]> {
  return {
    capturedAt: pending.capturedAt,
    sessionId: pending.sessionId,
    source: pending.source,
  };
}

/** Overlay disk pendingResume onto a running agent without consuming the stash. */
function withPendingResumeView(
  panel: TerminalPanelSession
): TerminalPanelSession {
  const pending = panel.pendingResume;
  const agent = panel.agent;
  if (!(pending && agent)) {
    return panel;
  }
  if (agent.status !== "running" || agent.agentId !== pending.agentId) {
    return panel;
  }
  if (agent.resume?.sessionId === pending.sessionId) {
    return panel;
  }
  if (agent.resume && agent.resume.capturedAt >= pending.capturedAt) {
    return panel;
  }
  return {
    ...panel,
    agent: {
      ...agent,
      resume: resumeFieldsFromPending(pending),
    },
  };
}

function stripPendingResume(panel: TerminalPanelSession): TerminalPanelSession {
  if (panel.pendingResume === undefined) {
    return panel;
  }
  const { pendingResume: _pending, ...rest } = panel;
  return rest;
}

export function withHealedHostTeardownSession(
  panel: TerminalPanelSession
): TerminalPanelSession {
  const healed = healHostTeardownAgentOnRead(panel.agent);
  const withAgent =
    healed === panel.agent ? panel : { ...panel, agent: healed };
  return stripPendingResume(withPendingResumeView(withAgent));
}

export async function recordTerminalPanelAgentSpawnGeneration(
  windowId: string,
  panelId: string,
  spawnGeneration: number
): Promise<void> {
  if (windowId.trim().length === 0 || panelId.trim().length === 0) {
    return;
  }
  if (!Number.isInteger(spawnGeneration) || spawnGeneration < 1) {
    return;
  }
  const s = await ensureTerminalSessionStore();
  s.mutate((state) => {
    const windowState = state.windows[windowId];
    const current = windowState?.panels[panelId];
    if (!(windowState && current?.agent)) {
      return state;
    }
    const nextAgent = {
      ...current.agent,
      restore: { spawnGeneration },
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
    return state;
  });
}
