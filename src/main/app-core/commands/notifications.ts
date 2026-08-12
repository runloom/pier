/**
 * notifications list/get/watch/focus/mark-read（W5-S2）。
 * 唯一读写 NCS；focus 复用 agentRuntimeIndex.focus，不改 FA / 运行结论。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  AppNotification,
  NotificationCenterSnapshot,
} from "@shared/contracts/notification-center.ts";
import type { CommandExecutionContext } from "../command-execution-context.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

type ListCmd = Extract<PierCommand, { type: "notifications.list" }>;
type GetCmd = Extract<PierCommand, { type: "notifications.get" }>;
type WatchCmd = Extract<PierCommand, { type: "notifications.watch" }>;
type FocusCmd = Extract<PierCommand, { type: "notifications.focus" }>;
type MarkReadCmd = Extract<PierCommand, { type: "notifications.mark-read" }>;

const DEFAULT_WATCH_TIMEOUT_MS = 30_000;
const DEFAULT_WATCH_POLL_MS = 250;

export interface NotificationCenterCommandFacade {
  markAllRead(): void;
  markRead(id: string): void;
  snapshot(): NotificationCenterSnapshot;
}

function mapItem(item: AppNotification) {
  return {
    id: item.id,
    kind: item.kind,
    severity: item.severity,
    title: item.title,
    read: item.read,
    ts: item.ts,
    ...(item.body ? { body: item.body } : {}),
    ...(item.agentRef ? { agentRef: item.agentRef } : {}),
    ...(item.panelRef?.panelId ? { panelId: item.panelRef.panelId } : {}),
    ...(item.dedupeKey ? { dedupeKey: item.dedupeKey } : {}),
    ...(item.repeatCount === undefined
      ? {}
      : { repeatCount: item.repeatCount }),
    ...(item.actions ? { actions: item.actions } : {}),
  };
}

async function resolveNcs(
  services: PierCoreServices
): Promise<NotificationCenterCommandFacade | null> {
  if (services.notificationCenter) {
    return services.notificationCenter;
  }
  try {
    const { getNotificationCenterService } = await import(
      "../../ipc/notification-center.ts"
    );
    return await getNotificationCenterService();
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function unavailable(requestId: string): PierCommandResult {
  return failure(
    requestId,
    "platform_unavailable",
    "Notification center is not available. Is Pier fully started?"
  );
}

export async function executeNotificationsListCommand(
  requestId: string,
  command: ListCmd,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const ncs = await resolveNcs(services);
  if (!ncs) {
    return unavailable(requestId);
  }
  const snap = ncs.snapshot();
  const items = command.unreadOnly
    ? snap.items.filter((item) => !item.read)
    : snap.items;
  return success(requestId, {
    items: items.map(mapItem),
    seq: snap.seq,
    unreadCount: snap.unreadCount,
    dndEnabled: snap.dndEnabled,
  });
}

export async function executeNotificationsGetCommand(
  requestId: string,
  command: GetCmd,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const ncs = await resolveNcs(services);
  if (!ncs) {
    return unavailable(requestId);
  }
  const item = ncs.snapshot().items.find((row) => row.id === command.id);
  if (!item) {
    return failure(
      requestId,
      "not_found",
      `Notification not found: ${command.id}`
    );
  }
  return success(requestId, { item: mapItem(item) });
}

export async function executeNotificationsWatchCommand(
  requestId: string,
  command: WatchCmd,
  services: PierCoreServices,
  context: CommandExecutionContext = {}
): Promise<PierCommandResult> {
  const ncs = await resolveNcs(services);
  if (!ncs) {
    return unavailable(requestId);
  }
  const timeoutMs = command.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS;
  const pollMs = command.pollMs ?? DEFAULT_WATCH_POLL_MS;
  const after = command.after;
  const deadline = Date.now() + timeoutMs;
  const signal = context.abortSignal;

  const first = ncs.snapshot();
  if (after === undefined || first.seq > after) {
    return success(requestId, {
      mode: after === undefined ? "snapshot" : "update",
      seq: first.seq,
      cursorScope: "notifications",
      items: first.items.map(mapItem),
      unreadCount: first.unreadCount,
    });
  }

  while (!signal?.aborted && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(pollMs, remaining), signal);
    if (signal?.aborted) {
      break;
    }
    // Always sample after sleep so an update that arrives during the wait
    // is not reported as timeout with a skipped seq.
    const next = ncs.snapshot();
    if (next.seq > after) {
      return success(requestId, {
        mode: "update",
        seq: next.seq,
        cursorScope: "notifications",
        items: next.items.map(mapItem),
        unreadCount: next.unreadCount,
      });
    }
  }

  const last = ncs.snapshot();
  if (signal?.aborted) {
    return success(requestId, {
      mode: "cancelled",
      seq: last.seq,
      cursorScope: "notifications",
      items: [],
      unreadCount: last.unreadCount,
      cancelled: true,
    });
  }
  // Final race: seq may have advanced after the last loop check.
  if (last.seq > after) {
    return success(requestId, {
      mode: "update",
      seq: last.seq,
      cursorScope: "notifications",
      items: last.items.map(mapItem),
      unreadCount: last.unreadCount,
    });
  }
  return success(requestId, {
    mode: "timeout",
    seq: last.seq,
    cursorScope: "notifications",
    items: [],
    unreadCount: last.unreadCount,
  });
}

export async function executeNotificationsFocusCommand(
  requestId: string,
  command: FocusCmd,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const ncs = await resolveNcs(services);
  if (!ncs) {
    return unavailable(requestId);
  }
  const item = ncs.snapshot().items.find((row) => row.id === command.id);
  if (!item) {
    return failure(
      requestId,
      "not_found",
      `Notification not found: ${command.id}`
    );
  }
  const agentRef = item.agentRef;
  if (!agentRef) {
    return failure(
      requestId,
      "not_found",
      "This notification has no agent to focus. Open the app notification center and check the panel is still open."
    );
  }
  // 与 Popover focus-panel 同构：只走 Runtime Index focus，不写 FA。
  const result = await services.agentRuntimeIndex.focus(agentRef);
  if (result.status === "ok") {
    return success(requestId, {
      focused: true,
      agentRef,
      status: result.status,
    });
  }
  if (result.status === "panel_gone" || result.status === "window_gone") {
    return failure(
      requestId,
      "not_found",
      result.status === "window_gone"
        ? "The window for this agent is gone. Re-open Pier or start the agent again."
        : "The panel for this agent is closed. Focus is unavailable."
    );
  }
  if (result.status === "empty") {
    return failure(
      requestId,
      "not_found",
      "No matching agent runtime is available to focus."
    );
  }
  return failure(
    requestId,
    "internal_error",
    result.message || "Failed to focus agent panel"
  );
}

export async function executeNotificationsMarkReadCommand(
  requestId: string,
  command: MarkReadCmd,
  services: PierCoreServices
): Promise<PierCommandResult> {
  const ncs = await resolveNcs(services);
  if (!ncs) {
    return unavailable(requestId);
  }
  if (command.all) {
    ncs.markAllRead();
    const snap = ncs.snapshot();
    return success(requestId, {
      marked: "all",
      unreadCount: snap.unreadCount,
      seq: snap.seq,
    });
  }
  if (!command.id) {
    return failure(
      requestId,
      "invalid_command",
      "notifications mark-read requires --id <id> or --all"
    );
  }
  const before = ncs.snapshot().items.find((row) => row.id === command.id);
  if (!before) {
    return failure(
      requestId,
      "not_found",
      `Notification not found: ${command.id}`
    );
  }
  const wasUnread = !before.read;
  ncs.markRead(command.id);
  const after = ncs.snapshot().items.find((row) => row.id === command.id);
  return success(requestId, {
    /** 1 = newly marked this call; 0 = already read (idempotent) */
    marked: wasUnread ? 1 : 0,
    id: command.id,
    read: after?.read ?? true,
    seq: ncs.snapshot().seq,
  });
}
