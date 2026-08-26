function panelKey(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

const commandFinishedKeys = new Set<string>();

/** OSC 133 D / native command_finished while Pier is still up. */
export function markForegroundAgentCommandFinished(
  panelId: string,
  windowId?: string | undefined
): void {
  if (!windowId || windowId.length === 0 || panelId.length === 0) {
    return;
  }
  commandFinishedKeys.add(panelKey(windowId, panelId));
}

export function clearForegroundAgentCommandFinished(
  panelId: string,
  windowId?: string | undefined
): void {
  if (panelId.length === 0) {
    return;
  }
  if (windowId && windowId.length > 0) {
    commandFinishedKeys.delete(panelKey(windowId, panelId));
    return;
  }
  const suffix = `\0${panelId}`;
  for (const key of [...commandFinishedKeys]) {
    if (key.endsWith(suffix)) {
      commandFinishedKeys.delete(key);
    }
  }
}

export function resetForegroundAgentCommandFinishedForTests(): void {
  commandFinishedKeys.clear();
}

/**
 * True when this panel's agent session already ended in-window: native
 * command_finished was ingested, or no raw hook/agent-launch slot remains
 * (including hidden launch-visibility layers). Used by L2 close/quit to
 * skip host-teardown (A14). Does not import L1.
 */
export function agentSessionEndedInForeground(
  panelId: string,
  windowId: string,
  hasAgentPresence: boolean
): boolean {
  if (windowId.length === 0 || panelId.length === 0) {
    return false;
  }
  if (commandFinishedKeys.has(panelKey(windowId, panelId))) {
    return true;
  }
  return !hasAgentPresence;
}
