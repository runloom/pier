import {
  cancelInitialTerminalInput,
  finishFailedAgentCommandInject,
  formatAgentCommandInjectFailedCopy,
  handleInitialInputInjectFailed,
  resolveInitialInputFailureAction,
  sendInitialTerminalInput,
  setAgentCommandInjectFailedReporter,
} from "@main/ipc/terminal/create-post-actions.ts";
import { signalPromptReady } from "@main/ipc/terminal/initial-input-gate.ts";
import type { NativeAddon } from "@main/ipc/terminal/native-addon.ts";
import { SUBMIT_ENTER_SETTLE_MS } from "@main/ipc/terminal/operations.ts";
import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace as workspaceEn } from "../../../../src/renderer/i18n/locales/en/workspace.ts";
import { workspace as workspaceJa } from "../../../../src/renderer/i18n/locales/ja/workspace.ts";
import { workspace as workspaceKo } from "../../../../src/renderer/i18n/locales/ko/workspace.ts";
import { workspace as workspaceZh } from "../../../../src/renderer/i18n/locales/zh-CN/workspace.ts";

function addonWith(handlers: {
  readViewportText?: () => string;
  sendKeyPress?: () => boolean;
  sendText: () => boolean;
}): NativeAddon {
  return {
    sendKeyPress: vi.fn(handlers.sendKeyPress ?? (() => true)),
    sendText: vi.fn(handlers.sendText),
    ...(handlers.readViewportText
      ? { readViewportText: handlers.readViewportText }
      : {}),
  } as unknown as NativeAddon;
}

async function flushSubmitEnter(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SUBMIT_ENTER_SETTLE_MS);
}

describe("terminal create post actions", () => {
  afterEach(() => {
    // 清掉可能残留的 fallback timer，防止跨用例污染。
    cancelInitialTerminalInput("terminal-1");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gates injection on prompt-ready and retries when the surface is not ready yet", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sendText = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const addon = addonWith({ sendText });

    sendInitialTerminalInput({
      addon,
      initialInput: "修复终端焦点问题\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });

    // Prompt 未就绪之前不写 stdin，避免 raw tty echo 打乱登录 banner。
    expect(addon.sendText).not.toHaveBeenCalled();

    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(addon.sendText).toHaveBeenCalledTimes(1);
    expect(addon.sendKeyPress).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(addon.sendText).toHaveBeenCalledTimes(2);
    expect(addon.sendText).toHaveBeenLastCalledWith(
      "7::terminal-1",
      "修复终端焦点问题"
    );
    expect(addon.sendKeyPress).not.toHaveBeenCalled();

    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("pastes the command then submits with a synthetic Return", async () => {
    vi.useFakeTimers();
    const addon = addonWith({ sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "pnpm setup:worktree\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(addon.sendText).toHaveBeenCalledWith(
      "7::terminal-1",
      "pnpm setup:worktree"
    );
    expect(addon.sendKeyPress).not.toHaveBeenCalled();

    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
  });

  it("submits when the submit flag is omitted", async () => {
    vi.useFakeTimers();
    const addon = addonWith({ sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "pnpm setup:worktree",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);
    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
  });

  it("cancelInitialTerminalInput prevents a pending inject and onFailed", async () => {
    vi.useFakeTimers();
    const onFailed = vi.fn();
    const addon = addonWith({ sendText: () => false });
    sendInitialTerminalInput({
      addon,
      initialInput: "pnpm setup:worktree",
      nativePanelId: "7::terminal-1",
      onFailed,
      panelId: "terminal-1",
    });
    cancelInitialTerminalInput("terminal-1");
    signalPromptReady("terminal-1");
    await vi.runAllTimersAsync();
    expect(addon.sendText).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("submits when initialInputSubmit is true even without a trailing newline", async () => {
    vi.useFakeTimers();
    const addon = addonWith({ sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "pnpm setup:worktree",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
      submit: true,
    });
    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(addon.sendText).toHaveBeenCalledWith(
      "7::terminal-1",
      "pnpm setup:worktree"
    );
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
  });

  it("does not inject Return when submit is explicitly false", async () => {
    vi.useFakeTimers();
    const addon = addonWith({ sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "partial",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
      submit: false,
    });
    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);
    await flushSubmitEnter();

    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-1", "partial");
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });

  it("retries only Return when paste succeeded but the key press is not ready", async () => {
    vi.useFakeTimers();
    const sendKeyPress = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const addon = addonWith({ sendKeyPress, sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "pnpm setup:worktree\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    signalPromptReady("terminal-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(addon.sendText).toHaveBeenCalledTimes(1);
    await flushSubmitEnter();
    // 第一次 Return 在 pasteTerminalText 内失败；随后只重试回车，不再粘贴。
    expect(addon.sendText).toHaveBeenCalledTimes(1);
    expect(sendKeyPress).toHaveBeenCalledTimes(2);
  });

  it("falls back to a timer when the shell integration never emits OSC 7", async () => {
    vi.useFakeTimers();
    const addon = addonWith({ sendText: () => true });

    sendInitialTerminalInput({
      addon,
      initialInput: "hello\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });

    expect(addon.sendText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(addon.sendText).toHaveBeenCalledTimes(1);
    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-1", "hello");
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledTimes(1);
  });

  it("calls onFailed after sendText retries are exhausted", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onFailed = vi.fn();
    const addon = addonWith({ sendText: () => false });

    sendInitialTerminalInput({
      addon,
      initialInput: "omp\r",
      nativePanelId: "7::terminal-1",
      onFailed,
      panelId: "terminal-1",
    });
    signalPromptReady("terminal-1");
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(addon.sendText).mock.calls.length).toBeGreaterThan(1);
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it("reports inject failure even when clearing the agent session throws", async () => {
    const report = vi.fn();
    const logError = vi.fn();
    setAgentCommandInjectFailedReporter(report);
    await finishFailedAgentCommandInject({
      clearAgent: async () => {
        throw new Error("session write failed");
      },
      logError,
      panelId: "panel-clear-1",
      skipClear: false,
    });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("panel-clear-1");
    setAgentCommandInjectFailedReporter(undefined);
  });

  it("keeps inject-failed copy aligned with workspace locales", () => {
    expect(formatAgentCommandInjectFailedCopy("en")).toEqual({
      body: workspaceEn.addPanelMenu.startAgentInjectFailed,
      title: workspaceEn.addPanelMenu.startAgentFailed,
    });
    expect(formatAgentCommandInjectFailedCopy("zh-CN")).toEqual({
      body: workspaceZh.addPanelMenu.startAgentInjectFailed,
      title: workspaceZh.addPanelMenu.startAgentFailed,
    });
    expect(formatAgentCommandInjectFailedCopy("ja")).toEqual({
      body: workspaceJa.addPanelMenu.startAgentInjectFailed,
      title: workspaceJa.addPanelMenu.startAgentFailed,
    });
    expect(formatAgentCommandInjectFailedCopy("ko")).toEqual({
      body: workspaceKo.addPanelMenu.startAgentInjectFailed,
      title: workspaceKo.addPanelMenu.startAgentFailed,
    });
  });

  it("skips injection entirely when initialInput is empty", () => {
    const addon = addonWith({ sendText: vi.fn() });
    sendInitialTerminalInput({
      addon,
      initialInput: undefined,
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    expect(addon.sendText).not.toHaveBeenCalled();
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });

  it("does not type until the viewport shows a painted prompt", async () => {
    vi.useFakeTimers();
    let viewport = "Last login: Sat Aug 15 15:03:30 on ttys012\n";
    const addon = addonWith({
      readViewportText: () => viewport,
      sendText: () => true,
    });
    sendInitialTerminalInput({
      addon,
      initialInput: "pi\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    signalPromptReady("terminal-1");
    expect(addon.sendText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(addon.sendText).not.toHaveBeenCalled();
    viewport =
      "Last login: Sat Aug 15 15:03:30 on ttys012\nloomdesk  feat/main (base) is v0.1.0";
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);
    expect(addon.sendText).toHaveBeenCalledTimes(1);
    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-1", "pi");
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
    await flushSubmitEnter();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
  });
});

describe("initial input inject failure action", () => {
  it("fails a running task when text was not delivered", () => {
    expect(
      resolveInitialInputFailureAction({
        hasAgent: false,
        lifecycleId: "run-1",
        taskStatus: "running",
        textDelivered: false,
      })
    ).toEqual({ completeTask: true, kind: "task" });
  });

  it("does not fail the run when Return failed after the command was typed", () => {
    expect(
      resolveInitialInputFailureAction({
        hasAgent: false,
        lifecycleId: "run-1",
        taskStatus: "running",
        textDelivered: true,
      })
    ).toEqual({ completeTask: false, kind: "task" });
  });

  it("keeps setup and prompt kinds for non-task surfaces", () => {
    expect(
      resolveInitialInputFailureAction({
        hasAgent: true,
        lifecycleId: "",
        taskStatus: undefined,
        textDelivered: false,
      })
    ).toEqual({ completeTask: false, kind: "prompt" });
    expect(
      resolveInitialInputFailureAction({
        hasAgent: false,
        lifecycleId: "",
        taskStatus: undefined,
        textDelivered: false,
      })
    ).toEqual({ completeTask: false, kind: "setup" });
  });

  it("completes a live task run from inject-failed", async () => {
    const completeFromExitCodeHint = vi.fn(async () => true);
    const sendFailed = vi.fn();
    handleInitialInputInjectFailed({
      browserWindowId: 7,
      completeFromExitCodeHint,
      hasAgent: false,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      sendFailed,
      taskStatus: "running",
      textDelivered: false,
      windowId: "main",
    });
    expect(sendFailed).toHaveBeenCalledWith({
      kind: "task",
      panelId: "terminal-1",
      textDelivered: false,
    });
    await vi.waitFor(() => {
      expect(completeFromExitCodeHint).toHaveBeenCalledWith({
        browserWindowId: 7,
        code: 1,
        lifecycleId: "run-1",
        panelId: "terminal-1",
        source: "inject-failed",
        windowId: "main",
      });
    });
  });
});
