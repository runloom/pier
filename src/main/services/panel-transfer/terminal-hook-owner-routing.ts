/**
 * Process-local owner alias map for terminal hook routing during panel transfer.
 *
 * Old PTY processes keep emitting the source `PIER_WINDOW_ID`. After commit,
 * hooks must update only the target owner; after rollback, only the source.
 * Cold start does not restore aliases.
 */

export interface TerminalHookOwnerRef {
  panelId: string;
  windowId: string;
}

function ownerKey(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

const aliases = new Map<string, TerminalHookOwnerRef>();

export function resolveOwner(
  windowId: string,
  panelId: string
): TerminalHookOwnerRef {
  const aliased = aliases.get(ownerKey(windowId, panelId));
  if (aliased) {
    return { panelId: aliased.panelId, windowId: aliased.windowId };
  }
  return { panelId, windowId };
}

export function activateAlias(
  source: TerminalHookOwnerRef,
  target: TerminalHookOwnerRef
): void {
  if (
    source.windowId.trim().length === 0 ||
    source.panelId.trim().length === 0 ||
    target.windowId.trim().length === 0 ||
    target.panelId.trim().length === 0
  ) {
    return;
  }
  aliases.set(ownerKey(source.windowId, source.panelId), {
    panelId: target.panelId,
    windowId: target.windowId,
  });
}

export function clearAlias(source: TerminalHookOwnerRef): void {
  aliases.delete(ownerKey(source.windowId, source.panelId));
}

export function transferPanelOwnership(
  source: TerminalHookOwnerRef,
  target: TerminalHookOwnerRef
): void {
  activateAlias(source, target);
}

/** Test / process shutdown helper. Not restored across cold starts. */
export function clearAllTerminalHookOwnerAliases(): void {
  aliases.clear();
}
