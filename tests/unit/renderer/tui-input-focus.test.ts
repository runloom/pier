import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTuiCursorSemanticsForTests } from "@/panel-kits/terminal/tui-cursor-semantics.ts";
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
  resetTuiCursorSemanticsForTests();
  cursorVisible.mockReset();
  sendKeyPress.mockReset();
  sendKeyPress.mockResolvedValue({ ok: true });
  setActivity(crushActivity);
});

/**
 * 会话观察（arming）：只有本会话见过 visible，hidden 才算风险信号。
 * 用一次 visible 读数完成 arm，再切到目标读数。
 */
async function armPanel(): Promise<void> {
  cursorVisible.mockResolvedValue("visible");
  await ensureTuiInputFocus("t-1");
  cursorVisible.mockReset();
}

describe("ensureTuiInputFocus", () => {
  it("探针 visible：不发恢复键，直接成功", async () => {
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("探针 hidden（见过 visible）：发一次 catalog 恢复键并轮询确认", async () => {
    await armPanel();
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

  it("探针 unknown：禁止当作失焦，不发键，直接放行", async () => {
    cursorVisible.mockResolvedValue("unknown");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("从未见过 visible：hidden 也放行且不发恢复键", async () => {
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("见过 visible 后：后续 hidden 才要求恢复或确认", async () => {
    await armPanel();
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
  });

  it("面板换 agent：旧观察作废，hidden 重新放行", async () => {
    await armPanel();
    setActivity({ ...crushActivity, agentId: "grok" });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("同面板重启同一种 agent：新活动会话 hidden 重新放行", async () => {
    await armPanel();
    setActivity({ ...crushActivity, spawnedAt: 2 });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("waiting 与 ready 相同：按光标探针决定", async () => {
    setActivity({ ...crushActivity, status: "waiting" });
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(cursorVisible).toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("waiting 下 hidden：提示上层确认，但不向确认对话框注入恢复键", async () => {
    await armPanel();
    setActivity({ ...crushActivity, status: "waiting" });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("未声明 inputFocusProbe 的 agent（claude）：不探针直接放行", async () => {
    setActivity({ ...crushActivity, agentId: "claude" });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(cursorVisible).not.toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("声明探针但无恢复键的 agent（grok）：见过 visible 后 hidden 交给上层确认", async () => {
    setActivity({ ...crushActivity, agentId: "grok" });
    await armPanel();
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(cursorVisible).toHaveBeenCalled();
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("声明探针的 agent（grok）：visible 直接放行", async () => {
    setActivity({ ...crushActivity, agentId: "grok" });
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("agentId 缺失：不探针直接放行", async () => {
    setActivity({ ...crushActivity, agentId: undefined });
    cursorVisible.mockResolvedValue("hidden");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(cursorVisible).not.toHaveBeenCalled();
  });

  it("非 agent 面板：直接失败", async () => {
    setActivity({ kind: "shell", panelId: "t-1" });
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("busy（processing/tool）也探针：见过 visible 后 hidden 交给上层确认", async () => {
    await armPanel();
    for (const status of ["processing", "tool"]) {
      setActivity({ ...crushActivity, status });
      cursorVisible.mockResolvedValue("hidden");
      await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    }
    expect(sendKeyPress).toHaveBeenCalled();
  });

  it("恢复键发送失败：返回 false 且不再轮询", async () => {
    await armPanel();
    cursorVisible.mockResolvedValue("hidden");
    sendKeyPress.mockResolvedValue({ ok: false });
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(false);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
    expect(cursorVisible).toHaveBeenCalledTimes(1);
  });

  it("确认超时：返回 false", async () => {
    await armPanel();
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
    await armPanel();
    cursorVisible.mockResolvedValueOnce("hidden").mockResolvedValue("visible");
    const [first, second] = await Promise.all([
      ensureTuiInputFocus("t-1"),
      ensureTuiInputFocus("t-1"),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
  });

  it("同面板新会话不复用旧会话的并发结果，旧探针也不向新会话发键", async () => {
    await armPanel();
    let resolveOldProbe: ((value: "hidden") => void) | undefined;
    const oldProbe = new Promise<"hidden">((resolve) => {
      resolveOldProbe = resolve;
    });
    cursorVisible.mockImplementationOnce(() => oldProbe);
    const oldSessionEnsure = ensureTuiInputFocus("t-1");

    setActivity({ ...crushActivity, spawnedAt: 2 });
    cursorVisible.mockResolvedValue("hidden");
    const newSessionEnsure = ensureTuiInputFocus("t-1");
    resolveOldProbe?.("hidden");

    await expect(newSessionEnsure).resolves.toBe(true);
    await expect(oldSessionEnsure).resolves.toBe(false);
    expect(sendKeyPress).not.toHaveBeenCalled();
  });

  it("互斥在完成后释放：下一轮可再次恢复", async () => {
    cursorVisible.mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    cursorVisible.mockResolvedValueOnce("hidden").mockResolvedValue("visible");
    await expect(ensureTuiInputFocus("t-1")).resolves.toBe(true);
    expect(sendKeyPress).toHaveBeenCalledTimes(1);
  });
});
