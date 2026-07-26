import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTuiInputFocus,
  resetTuiInputFocusForTests,
} from "@/panel-kits/terminal/tui-input-focus.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

const cursorVisible = vi.fn<(panelId: string) => Promise<string>>();
const sendKeyPress = vi.fn<(args: unknown) => Promise<{ ok: boolean }>>();

function installTerminalApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        cursorVisible,
        sendKeyPress,
      },
    },
  });
}

function setActivity(activity: unknown): void {
  useForegroundActivityStore.setState({
    activities: { "t-1": activity },
  } as never);
}

const crushActivity = {
  agentId: "crush",
  kind: "agent",
  panelId: "t-1",
  source: "launch",
  subagentCount: 0,
  spawnedAt: 1,
  status: "ready",
  updatedAt: 1,
  windowId: "w-1",
};

beforeEach(() => {
  installTerminalApi();
  resetTuiInputFocusForTests();
  cursorVisible.mockReset();
  sendKeyPress.mockReset();
  sendKeyPress.mockResolvedValue({ ok: true });
  setActivity(crushActivity);
});

describe("ensureTuiInputFocus", () => {
  it("探针 visible：不发恢复键，直接成功", async () => {
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("探针 hidden：发一次 catalog 恢复键并轮询确认", async () => {
    cursorVisible
      .mockResolvedValueOnce("hidden")
      .mockResolvedValueOnce("hidden")
      .mockResolvedValueOnce("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
    expect(sendKeyPress).toHaveBeenCalledWith({
      keycode: APPKIT_KEYCODE.tab,
      panelId: "t-1",
    });
    expect(cursorVisible.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("探针 unknown：禁止当作失焦，不发键，确认失败", async () => {
    cursorVisible.mockResolvedValue("unknown");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("waiting 与 ready 相同：按光标探针决定", async () => {
    setActivity({ ...crushActivity, status: "waiting" });
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(cursorVisible).toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("未声明 inputFocusKey 的 agent：hidden 时失败且不注键", async () => {
    setActivity({ ...crushActivity, agentId: "claude" });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(cursorVisible).toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("未声明 inputFocusKey 的 agent：visible 时成功", async () => {
    setActivity({ ...crushActivity, agentId: "grok" });
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("非 agent 面板：直接失败", async () => {
    setActivity({ kind: "shell", panelId: "t-1" });
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("busy（processing/tool）也探针：hidden 不放行", async () => {
    for (const status of ["processing", "tool"]) {
      setActivity({ ...crushActivity, status });
      cursorVisible.mockResolvedValue("hidden");
      await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    }
    expect(sendKeyPress).toHaveBeenCalled();
  });

  it("恢复键发送失败：返回 false 且不再轮询", async () => {
    cursorVisible.mockResolvedValue("hidden");
    sendKeyPress.mockResolvedValue({ ok: false });
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
    expect(cursorVisible).toHaveBeenCalledTimes(1);
  });

  it("确认超时：返回 false", async () => {
    vi.useFakeTimers();
    try {
      cursorVisible.mockResolvedValue("hidden");
      const pending = ensureTuiInputFocus("t-1");
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBe(false);
      expect(sendKeyPress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("并发触发 per-panel 互斥：只发一次恢复键（防 toggle 双击）", async () => {
    cursorVisible.mockResolvedValueOnce("hidden").mockResolvedValue("visible");
    const [first, second] = await Promise.all([
      ensureTuiInputFocus("t-1"),
      ensureTuiInputFocus("t-1"),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
  });

  it("互斥在完成后释放：下一轮可再次恢复", async () => {
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    cursorVisible.mockResolvedValueOnce("hidden").mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
  });
});
