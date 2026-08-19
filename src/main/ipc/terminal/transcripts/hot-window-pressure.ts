/**
 * 终端热窗压力策略（历史三层化之上的内存回收，0108）。
 *
 * 隐藏（dockview 背景 tab / 不可见）超过阈值的 surface，把 scrollback
 * 热窗收缩到小值——完整历史在磁盘 transcript（Tier 2），经「查看完整
 * 历史」一个手势可达，什么都没丢；重新可见立即恢复用户偏好上限。
 */

export const TERMINAL_HIDDEN_SHRINK_AFTER_MS = 15 * 60_000;
export const TERMINAL_HIDDEN_SCROLLBACK_BYTES = 4_000_000;
export const TERMINAL_PRESSURE_TICK_MS = 60_000;

interface TrackedSurface {
  hiddenSince: number | null;
  shrunk: boolean;
}

export interface TerminalHotWindowPressureDeps {
  now?: () => number;
  /** 用户偏好的 scrollback 上限（恢复目标）；由 set-config 更新。 */
  preferredLimitBytes?: number;
  setScrollbackLimit(nativePanelId: string, limitBytes: number): boolean;
  shrinkAfterMs?: number;
  shrunkLimitBytes?: number;
  startTimer?: boolean;
  tickMs?: number;
}

export function createTerminalHotWindowPressure(
  deps: TerminalHotWindowPressureDeps
) {
  const now = deps.now ?? Date.now;
  const shrinkAfterMs = deps.shrinkAfterMs ?? TERMINAL_HIDDEN_SHRINK_AFTER_MS;
  const shrunkLimitBytes =
    deps.shrunkLimitBytes ?? TERMINAL_HIDDEN_SCROLLBACK_BYTES;
  /** browserWindowId → nativePanelId → 状态。 */
  const byWindow = new Map<number, Map<string, TrackedSurface>>();
  let preferredLimitBytes = deps.preferredLimitBytes ?? 64_000_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  function restore(nativePanelId: string, tracked: TrackedSurface): void {
    if (tracked.shrunk) {
      tracked.shrunk = false;
      deps.setScrollbackLimit(nativePanelId, preferredLimitBytes);
    }
  }

  function observeWindowSnapshot(
    browserWindowId: number,
    entries: ReadonlyArray<{ nativePanelId: string; visible: boolean }>
  ): void {
    let tracked = byWindow.get(browserWindowId);
    if (!tracked) {
      tracked = new Map();
      byWindow.set(browserWindowId, tracked);
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.nativePanelId);
      let state = tracked.get(entry.nativePanelId);
      if (!state) {
        state = { hiddenSince: null, shrunk: false };
        tracked.set(entry.nativePanelId, state);
      }
      if (entry.visible) {
        state.hiddenSince = null;
        restore(entry.nativePanelId, state);
      } else if (state.hiddenSince === null) {
        state.hiddenSince = now();
      }
    }
    // 不在快照里的 surface 已关闭 / 迁走：停止跟踪。
    for (const key of tracked.keys()) {
      if (!seen.has(key)) {
        tracked.delete(key);
      }
    }
    if (tracked.size === 0) {
      byWindow.delete(browserWindowId);
    }
  }

  function tick(): void {
    const timestamp = now();
    for (const tracked of byWindow.values()) {
      for (const [nativePanelId, state] of tracked) {
        if (
          state.hiddenSince !== null &&
          !state.shrunk &&
          timestamp - state.hiddenSince >= shrinkAfterMs
        ) {
          state.shrunk = true;
          deps.setScrollbackLimit(nativePanelId, shrunkLimitBytes);
        }
      }
    }
  }

  if (deps.startTimer !== false) {
    timer = setInterval(tick, deps.tickMs ?? TERMINAL_PRESSURE_TICK_MS);
    timer.unref?.();
  }

  return {
    dispose(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      byWindow.clear();
    },
    observeWindowSnapshot,
    /** 窗口级 setTerminalConfig 会把偏好上限写回所有 surface；收缩态必须重施压。 */
    reapplyShrunkLimits(): void {
      for (const tracked of byWindow.values()) {
        for (const [nativePanelId, state] of tracked) {
          if (state.shrunk) {
            deps.setScrollbackLimit(nativePanelId, shrunkLimitBytes);
          }
        }
      }
    },
    setPreferredLimit(limitBytes: number): void {
      if (Number.isFinite(limitBytes) && limitBytes > 0) {
        preferredLimitBytes = limitBytes;
      }
    },
    tick,
  };
}

export type TerminalHotWindowPressure = ReturnType<
  typeof createTerminalHotWindowPressure
>;
