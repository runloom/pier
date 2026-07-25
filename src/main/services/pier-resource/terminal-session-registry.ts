/**
 * 终端资源登记：create/close 时写入 panel，不依赖 shell 环境变量可读性。
 *
 * 背景：macOS 上 Ghostty 经 `login -flp … exec -l zsh` 启动交互 shell 时，
 * login shell 往往拿不到/读不到 PIER_PANEL_ID；只有部分子进程继承后仍可见。
 * 因此空闲终端无法单靠 env 扫描出现在资源账本里。
 */

export interface TerminalResourceRegistration {
  createdAt: number;
  /** login 进程 pid（若已解析） */
  loginPid: number | null;
  panelId: string;
  /** 用于聚合的根：优先 shell，否则 login */
  rootPid: number | null;
  /** 交互 shell pid（zsh/bash…） */
  shellPid: number | null;
  /** Electron BrowserWindow.id 字符串（与 PIER_WINDOW_ID / activity 一致） */
  windowId: string;
}

function keyOf(windowId: string, panelId: string): string {
  return `${windowId}\0${panelId}`;
}

const registrations = new Map<string, TerminalResourceRegistration>();

export function registerTerminalResourceSession(input: {
  panelId: string;
  windowId: string;
}): void {
  if (input.panelId.length === 0 || input.windowId.length === 0) {
    return;
  }
  const key = keyOf(input.windowId, input.panelId);
  const existing = registrations.get(key);
  if (existing) {
    return;
  }
  registrations.set(key, {
    createdAt: Date.now(),
    loginPid: null,
    panelId: input.panelId,
    rootPid: null,
    shellPid: null,
    windowId: input.windowId,
  });
}

export function unregisterTerminalResourceSession(input: {
  panelId: string;
  windowId: string;
}): void {
  registrations.delete(keyOf(input.windowId, input.panelId));
}

export function clearTerminalResourceSessionsForWindow(windowId: string): void {
  for (const [key, value] of registrations) {
    if (value.windowId === windowId) {
      registrations.delete(key);
    }
  }
}

export function listTerminalResourceSessions(): TerminalResourceRegistration[] {
  return [...registrations.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function bindTerminalResourcePids(input: {
  loginPid: number | null;
  panelId: string;
  rootPid: number | null;
  shellPid: number | null;
  windowId: string;
}): void {
  const key = keyOf(input.windowId, input.panelId);
  const existing = registrations.get(key);
  if (!existing) {
    return;
  }
  registrations.set(key, {
    ...existing,
    loginPid: input.loginPid,
    rootPid: input.rootPid,
    shellPid: input.shellPid,
  });
}

/** 测试用 */
export function resetTerminalResourceRegistryForTests(): void {
  registrations.clear();
}
