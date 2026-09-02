/**
 * 会话范围键：panelId 跨窗口不唯一，必须与 windowId 成对使用。
 * 不组装/解析宿主侧的智能体会话引用（那只发生在 main）。
 */
export function panelScopeKey(windowId: string, panelId: string): string {
  return `${windowId}\u0000${panelId}`;
}

export function matchesPanelScope(
  entry: { panelId?: string; windowId?: string },
  panelId: string,
  windowId: string | undefined
): boolean {
  if (entry.panelId !== panelId) {
    return false;
  }
  if (windowId === undefined || windowId.length === 0) {
    return true;
  }
  return entry.windowId === windowId;
}

export function findUniqueScoped<T>(
  entries: readonly T[],
  panelId: string,
  windowId: string | undefined,
  of: (entry: T) => { panelId?: string; windowId?: string }
): T | null {
  const matches = entries.filter((entry) =>
    matchesPanelScope(of(entry), panelId, windowId)
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
