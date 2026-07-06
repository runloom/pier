import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  CreateTerminalArgs,
  TerminalAgentResumeMetadata,
} from "@shared/contracts/terminal.ts";
import type {
  ResolvedTerminalLaunchOptions,
  TerminalAgentRestoreLaunchOptions,
} from "@shared/contracts/terminal-launch.ts";
import {
  updateTerminalPanelAgent,
  updateTerminalPanelContext,
  updateTerminalPanelTask,
} from "../state/terminal-session-state.ts";

export async function persistInitialTerminalContext(
  sessionScope: string,
  panelId: string,
  context: CreateTerminalArgs["context"]
): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await updateTerminalPanelContext(sessionScope, panelId, context);
  } catch (err) {
    console.error("[pier-context-initial-persist] failed:", err);
  }
}

export async function persistInitialTerminalTask(
  sessionScope: string,
  panelId: string,
  task: CreateTerminalArgs["task"]
): Promise<void> {
  if (!task) {
    return;
  }
  try {
    await updateTerminalPanelTask(sessionScope, panelId, task);
  } catch (err) {
    console.error("[pier-task-initial-persist] failed:", err);
  }
}

export async function persistInitialTerminalAgent(
  sessionScope: string,
  panelId: string,
  agentId: AgentKind | undefined,
  launch: ResolvedTerminalLaunchOptions | undefined,
  options: { resume?: TerminalAgentResumeMetadata | undefined } = {}
): Promise<void> {
  if (!(agentId && launch)) {
    return;
  }
  const restoreLaunch: TerminalAgentRestoreLaunchOptions = {
    ...(launch.agentId && { agentId: launch.agentId }),
    ...(launch.command && { command: launch.command }),
    ...(launch.cwd && { cwd: launch.cwd }),
  };
  try {
    await updateTerminalPanelAgent(sessionScope, panelId, {
      agentId,
      launch: restoreLaunch,
      ...(options.resume && { resume: options.resume }),
      startedAt: Date.now(),
      status: "running",
    });
  } catch (err) {
    console.error("[pier-agent-initial-persist] failed:", err);
  }
}
