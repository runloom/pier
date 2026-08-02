/**
 * 观测卡在 Web 侧的终端输入 owner，超时写入 input-routing trace。
 * 只点名不释放，避免掩盖泄漏。
 */
import { recordTerminalInputRoutingTrace } from "@/lib/terminal-debug/input-routing-trace.ts";
import { getTerminalFocusRoutingDebugSnapshot } from "@/stores/terminal-input-routing-slice.ts";

const CHECK_INTERVAL_MS = 5000;
const DRAG_OWNER_STUCK_MS = 15_000;
const DURABLE_OWNER_STUCK_MS = 120_000;
const DRAG_OWNER_PREFIXES = ["dockview-tab-drag:", "dockview-sash-drag:"];
const MAX_REPORTED_OWNER_IDS = 16;

let intervalId: number | null = null;
const firstSeenAtByOwnerId = new Map<string, number>();
const reportedOwnerIds = new Set<string>();

function stuckThresholdFor(ownerId: string): number {
  return DRAG_OWNER_PREFIXES.some((prefix) => ownerId.startsWith(prefix))
    ? DRAG_OWNER_STUCK_MS
    : DURABLE_OWNER_STUCK_MS;
}

function forgetReleasedOwners(currentIds: Set<string>): void {
  for (const ownerId of firstSeenAtByOwnerId.keys()) {
    if (!currentIds.has(ownerId)) {
      firstSeenAtByOwnerId.delete(ownerId);
      reportedOwnerIds.delete(ownerId);
    }
  }
}

export function checkTerminalWebOwnerRetention(): void {
  const snapshot = getTerminalFocusRoutingDebugSnapshot();
  const currentIds = new Set(snapshot.webRequestIds);
  forgetReleasedOwners(currentIds);

  const now = Date.now();
  for (const ownerId of currentIds) {
    if (!firstSeenAtByOwnerId.has(ownerId)) {
      firstSeenAtByOwnerId.set(ownerId, now);
    }
  }
  // base 已是 web 时，owner 持有键盘是合法态，不算泄漏。
  if (
    snapshot.basePanel.kind !== "terminal" ||
    snapshot.effectiveKind !== "web"
  ) {
    return;
  }
  for (const ownerId of currentIds) {
    if (reportedOwnerIds.has(ownerId)) {
      continue;
    }
    const firstSeenAt = firstSeenAtByOwnerId.get(ownerId);
    if (firstSeenAt === undefined) {
      continue;
    }
    const heldMs = now - firstSeenAt;
    if (heldMs < stuckThresholdFor(ownerId)) {
      continue;
    }
    reportedOwnerIds.add(ownerId);
    recordTerminalInputRoutingTrace({
      action: "owner-stuck",
      basePanelKind: snapshot.basePanel.kind,
      effectiveKind: snapshot.effectiveKind,
      heldMs,
      ownerIds: snapshot.webRequestIds.slice(0, MAX_REPORTED_OWNER_IDS),
      source: "input-owner-watch",
      stuckOwnerId: ownerId,
    });
  }
}

export function installTerminalWebOwnerRetentionWatch(): void {
  if (intervalId !== null) {
    return;
  }
  intervalId = window.setInterval(
    checkTerminalWebOwnerRetention,
    CHECK_INTERVAL_MS
  );
}

export function resetTerminalWebOwnerRetentionWatchForTests(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  firstSeenAtByOwnerId.clear();
  reportedOwnerIds.clear();
}
