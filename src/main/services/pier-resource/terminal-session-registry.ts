/**
 * 终端资源登记：create/close 时写入 panel，不依赖 shell 环境变量可读性。
 *
 * 背景：macOS 上 Ghostty 经 `login -flp … exec -l zsh` 启动交互 shell 时，
 * 平台二进制 login/zsh 的 environ 往往对 `ps -E` 不可读；只有部分子进程
 * （node/agent）继承后仍可见。因此空闲终端无法单靠 env 扫描出数。
 *
 * create 成功后写入 seedPid（通常是新出现的 login），聚合根优先 login。
 */

export interface TerminalResourceRegistration {
  createdAt: number;
  /** login 进程 pid（若已解析） */
  loginPid: number | null;
  panelId: string;
  /**
   * 用于聚合的根：优先 login（整棵 PTY 子树），否则 shell / seed。
   */
  rootPid: number | null;
  /**
   * create 时钉死的会话种子 pid（通常是 login）。
   * 不依赖 env 可读；进程死后由 reconcile 清空绑定逻辑处理。
   */
  seedPid: number | null;
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
  seedPid?: number | null;
  windowId: string;
}): void {
  if (input.panelId.length === 0 || input.windowId.length === 0) {
    return;
  }
  const key = keyOf(input.windowId, input.panelId);
  const existing = registrations.get(key);
  if (existing) {
    if (
      input.seedPid !== undefined &&
      input.seedPid !== null &&
      existing.seedPid === null
    ) {
      registrations.set(key, { ...existing, seedPid: input.seedPid });
    }
    return;
  }
  registrations.set(key, {
    createdAt: Date.now(),
    loginPid: null,
    panelId: input.panelId,
    rootPid: null,
    seedPid: input.seedPid ?? null,
    shellPid: null,
    windowId: input.windowId,
  });
}

/** create 成功后写入/更新 seed，并尽量立刻绑根。 */
export function bindTerminalResourceSeed(input: {
  loginPid?: number | null;
  panelId: string;
  rootPid?: number | null;
  seedPid: number;
  shellPid?: number | null;
  windowId: string;
}): void {
  if (input.panelId.length === 0 || input.windowId.length === 0) {
    return;
  }
  if (!Number.isFinite(input.seedPid) || input.seedPid <= 0) {
    return;
  }
  const key = keyOf(input.windowId, input.panelId);
  const existing = registrations.get(key);
  const base: TerminalResourceRegistration = existing ?? {
    createdAt: Date.now(),
    loginPid: null,
    panelId: input.panelId,
    rootPid: null,
    seedPid: null,
    shellPid: null,
    windowId: input.windowId,
  };
  registrations.set(key, {
    ...base,
    loginPid: input.loginPid ?? base.loginPid,
    rootPid: input.rootPid ?? base.rootPid,
    seedPid: input.seedPid,
    shellPid: input.shellPid ?? base.shellPid,
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

/**
 * 清空绑定（seed 死后）。clearSeed 时连 seedPid 一并去掉，避免占 claimed。
 */
export function clearTerminalResourceBinding(input: {
  clearSeed?: boolean;
  panelId: string;
  windowId: string;
}): void {
  const key = keyOf(input.windowId, input.panelId);
  const existing = registrations.get(key);
  if (!existing) {
    return;
  }
  registrations.set(key, {
    ...existing,
    loginPid: null,
    rootPid: null,
    seedPid: input.clearSeed ? null : existing.seedPid,
    shellPid: null,
  });
}

/** 测试用 */
export function resetTerminalResourceRegistryForTests(): void {
  registrations.clear();
}
