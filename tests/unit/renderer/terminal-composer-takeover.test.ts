import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerTerminalComposerTakeover,
  resetTerminalComposerTakeoverForTests,
  terminalComposerTakeoverFocus,
} from "@/stores/terminal-composer-takeover.ts";

afterEach(() => {
  resetTerminalComposerTakeoverForTests();
});

describe("terminal composer takeover registry", () => {
  it("注册后 handler 被调用，其返回值原样透传；未注册返回 false", () => {
    const handler = vi.fn(() => true);
    registerTerminalComposerTakeover("t-1", handler);

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(true);
    expect(handler).toHaveBeenCalledWith("activate");
    expect(terminalComposerTakeoverFocus("t-2", "activate")).toBe(false);
  });

  it("默认 reason 为 activate", () => {
    const handler = vi.fn(() => true);
    registerTerminalComposerTakeover("t-1", handler);

    expect(terminalComposerTakeoverFocus("t-1")).toBe(true);
    expect(handler).toHaveBeenCalledWith("activate");
  });

  it("surface reason 原样转发", () => {
    const handler = vi.fn(() => false);
    registerTerminalComposerTakeover("t-1", handler);

    expect(terminalComposerTakeoverFocus("t-1", "surface")).toBe(false);
    expect(handler).toHaveBeenCalledWith("surface");
  });

  it("回调返回 false 时 terminalComposerTakeoverFocus 也返回 false（接管失败，调用方应走原生归还路径）", () => {
    const handler = vi.fn(() => false);
    registerTerminalComposerTakeover("t-1", handler);

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("disposer 移除注册后 handler 不再调用，返回 false", () => {
    const handler = vi.fn(() => true);
    const dispose = registerTerminalComposerTakeover("t-1", handler);

    dispose();

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("重复注册以最新为准，旧 disposer 不误删新注册", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const disposeFirst = registerTerminalComposerTakeover("t-1", first);
    registerTerminalComposerTakeover("t-1", second);

    disposeFirst();

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("resetTerminalComposerTakeoverForTests 清空所有注册", () => {
    registerTerminalComposerTakeover("t-1", vi.fn());
    registerTerminalComposerTakeover("t-2", vi.fn());

    resetTerminalComposerTakeoverForTests();

    expect(terminalComposerTakeoverFocus("t-1", "activate")).toBe(false);
    expect(terminalComposerTakeoverFocus("t-2", "activate")).toBe(false);
  });
});
