import type {
  AgentRuntimeFocusResult,
  AgentRuntimeIndexSnapshot,
} from "@shared/contracts/agent-runtime-index.ts";
import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { LocalEnvironmentState } from "@shared/contracts/environment.ts";
import type {
  SystemNotificationPermissionSnapshot,
  SystemNotificationUnavailableReason,
} from "@shared/contracts/notification.ts";
import type { PluginRegistryListResult } from "@shared/contracts/plugin.ts";
import type { ProjectSkillsInvalidatedEvent } from "@shared/contracts/project-skills.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import type { WorktreeCreateProgress } from "@shared/contracts/worktree.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { findInternalWindowId } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";

function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const win of windowManager.getAll()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function broadcastMruState(state: MruState): void {
  broadcastToAllWindows(PIER_BROADCAST.COMMAND_PALETTE_MRU_CHANGED, state);
}

export function broadcastTerminalStatusBarPrefs(
  prefs: TerminalStatusBarPrefs
): void {
  broadcastToAllWindows(
    PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
    prefs
  );
}

export function broadcastPluginRegistryChanged(
  result: PluginRegistryListResult
): void {
  broadcastToAllWindows(PIER_BROADCAST.PLUGINS_CHANGED, result);
}

export function broadcastEnvironmentsChanged(
  snapshot: LocalEnvironmentState
): void {
  broadcastToAllWindows(PIER_BROADCAST.ENVIRONMENTS_CHANGED, snapshot);
}

export function broadcastTaskRunsSnapshot(snapshot: TaskRunsSnapshot): void {
  for (const win of windowManager.getAll()) {
    if (win.isDestroyed()) {
      continue;
    }
    const windowId = findInternalWindowId(win);
    win.webContents.send(PIER_BROADCAST.TASKS_RUNS_CHANGED, {
      runs: Object.fromEntries(
        Object.entries(snapshot.runs).filter(
          ([, run]) => windowId !== null && run.ownerWindowId === windowId
        )
      ),
      version: snapshot.version,
    } satisfies TaskRunsSnapshot);
  }
}

export function broadcastAppUpdateChanged(snapshot: AppUpdateSnapshot): void {
  broadcastToAllWindows(PIER_BROADCAST.APP_UPDATE_CHANGED, snapshot);
}

export function broadcastWorktreeCreateProgress(
  progress: WorktreeCreateProgress
): void {
  broadcastToAllWindows(PIER_BROADCAST.WORKTREE_CREATE_PROGRESS, progress);
}

export function broadcastUsageDataChanged(
  snapshot: UsageAggregateSnapshot
): void {
  broadcastToAllWindows(PIER_BROADCAST.USAGE_DATA_CHANGED, snapshot);
}

export function broadcastAgentRuntimeIndexChanged(
  snapshot: AgentRuntimeIndexSnapshot
): void {
  broadcastToAllWindows(PIER_BROADCAST.AGENT_RUNTIME_INDEX_CHANGED, snapshot);
}

export function broadcastAgentRuntimeFocusFeedback(
  result: AgentRuntimeFocusResult
): void {
  broadcastToAllWindows(PIER_BROADCAST.AGENT_RUNTIME_FOCUS_FEEDBACK, result);
}

export function broadcastAgentAttentionDegraded(payload: {
  reason: SystemNotificationUnavailableReason;
}): void {
  broadcastToAllWindows(PIER_BROADCAST.AGENT_ATTENTION_DEGRADED, payload);
}

export function broadcastSystemNotificationPermissionChanged(
  snapshot: SystemNotificationPermissionSnapshot
): void {
  broadcastToAllWindows(
    PIER_BROADCAST.SYSTEM_NOTIFICATION_PERMISSION_CHANGED,
    snapshot
  );
}

/**
 * 向单一 renderer 下发内置 Attention 播音。
 * 优先 focused 窗，否则第一个存活窗；禁止 all-windows 各播一次。
 */
export function sendAttentionSoundPlayToOneWindow(payload: {
  soundId: string;
}): boolean {
  const win = windowManager.getFocused() ?? windowManager.getAll()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return false;
  }
  if (win.webContents.isDestroyed()) {
    return false;
  }
  win.webContents.send(PIER_BROADCAST.ATTENTION_SOUND_PLAY, payload);
  return true;
}

export function broadcastProjectSkillsInvalidated(
  event: Omit<ProjectSkillsInvalidatedEvent, "type">
): void {
  broadcastToAllWindows(PIER_BROADCAST.PROJECT_SKILLS_INVALIDATED, {
    type: "project-skills.invalidated",
    ...event,
  } satisfies ProjectSkillsInvalidatedEvent);
}
