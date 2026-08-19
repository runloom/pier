import { describe, expect, it } from "vitest";
import {
  createTerminalHotWindowPressure,
  TERMINAL_HIDDEN_SCROLLBACK_BYTES,
  TERMINAL_HIDDEN_SHRINK_AFTER_MS,
} from "../../../../src/main/ipc/terminal/transcripts/hot-window-pressure.ts";

function createHarness(preferred = 64_000_000) {
  let nowValue = 1_000_000;
  const calls: Array<{ bytes: number; key: string }> = [];
  const pressure = createTerminalHotWindowPressure({
    now: () => nowValue,
    preferredLimitBytes: preferred,
    setScrollbackLimit: (key, bytes) => {
      calls.push({ bytes, key });
      return true;
    },
    startTimer: false,
  });
  return {
    advance(ms: number) {
      nowValue += ms;
    },
    calls,
    pressure,
  };
}

describe("terminal hot-window pressure (0108)", () => {
  it("shrinks a surface hidden beyond the threshold and restores on visibility", () => {
    const { advance, calls, pressure } = createHarness();
    const key = "1::terminal-a";

    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: false }]);
    pressure.tick();
    expect(calls).toEqual([]);

    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS + 1);
    pressure.tick();
    expect(calls).toEqual([{ bytes: TERMINAL_HIDDEN_SCROLLBACK_BYTES, key }]);

    // 重复 tick 不重复收缩。
    pressure.tick();
    expect(calls).toHaveLength(1);

    // 重新可见：立即恢复偏好上限。
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: true }]);
    expect(calls).toEqual([
      { bytes: TERMINAL_HIDDEN_SCROLLBACK_BYTES, key },
      { bytes: 64_000_000, key },
    ]);
  });

  it("reapplies the shrink cap after a window-level config broadcast", () => {
    const { advance, calls, pressure } = createHarness();
    const key = "1::terminal-config";
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: false }]);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS + 1);
    pressure.tick();
    expect(calls).toEqual([{ bytes: TERMINAL_HIDDEN_SCROLLBACK_BYTES, key }]);

    pressure.setPreferredLimit(128_000_000);
    pressure.reapplyShrunkLimits();
    expect(calls.at(-1)).toEqual({
      bytes: TERMINAL_HIDDEN_SCROLLBACK_BYTES,
      key,
    });
  });

  it("uses the latest preferred limit when restoring", () => {
    const { advance, calls, pressure } = createHarness();
    const key = "1::terminal-b";
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: false }]);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS + 1);
    pressure.tick();
    pressure.setPreferredLimit(128_000_000);
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: true }]);
    expect(calls.at(-1)).toEqual({ bytes: 128_000_000, key });
  });

  it("hidden clock resets when a surface becomes visible before the threshold", () => {
    const { advance, calls, pressure } = createHarness();
    const key = "1::terminal-c";
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: false }]);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS - 1000);
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: true }]);
    pressure.observeWindowSnapshot(1, [{ nativePanelId: key, visible: false }]);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS - 1000);
    pressure.tick();
    expect(calls).toEqual([]);
  });

  it("drops tracking for surfaces missing from the window snapshot", () => {
    const { advance, calls, pressure } = createHarness();
    pressure.observeWindowSnapshot(1, [
      { nativePanelId: "1::gone", visible: false },
    ]);
    // 面板关闭：新快照不含该 surface。
    pressure.observeWindowSnapshot(1, []);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS * 2);
    pressure.tick();
    expect(calls).toEqual([]);
  });

  it("tracks windows independently", () => {
    const { advance, calls, pressure } = createHarness();
    pressure.observeWindowSnapshot(1, [
      { nativePanelId: "1::a", visible: false },
    ]);
    pressure.observeWindowSnapshot(2, [
      { nativePanelId: "2::b", visible: true },
    ]);
    advance(TERMINAL_HIDDEN_SHRINK_AFTER_MS + 1);
    pressure.tick();
    expect(calls).toEqual([
      { bytes: TERMINAL_HIDDEN_SCROLLBACK_BYTES, key: "1::a" },
    ]);
    pressure.dispose();
  });
});
