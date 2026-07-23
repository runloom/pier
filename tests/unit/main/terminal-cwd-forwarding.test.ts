import { beforeEach, describe, expect, it, vi } from "vitest";

const resolvePanelContextForPath = vi.fn();
const recordRecentPanelContext = vi.fn();
const peekTerminalPanelContext = vi.fn();
const updateTerminalPanelContext = vi.fn();
const forwardToWindow = vi.fn();
const windowRecordIdFor = vi.fn(() => "win-1");

vi.mock("@main/services/panel-context-resolver.ts", () => ({
  resolvePanelContextForPath: (...args: unknown[]) =>
    resolvePanelContextForPath(...args),
}));
vi.mock("@main/state/panel-context-state.ts", () => ({
  recordRecentPanelContext: (...args: unknown[]) =>
    recordRecentPanelContext(...args),
}));
vi.mock("@main/state/terminal-session-state.ts", () => ({
  peekTerminalPanelContext: (...args: unknown[]) =>
    peekTerminalPanelContext(...args),
  updateTerminalPanelContext: (...args: unknown[]) =>
    updateTerminalPanelContext(...args),
}));
vi.mock("@main/ipc/terminal-forwarding.ts", () => ({
  forwardToWindow: (...args: unknown[]) => forwardToWindow(...args),
}));
vi.mock("@main/ipc/terminal-window-scope.ts", () => ({
  windowRecordIdFor: (...args: unknown[]) => windowRecordIdFor(...args),
}));

import {
  handleTerminalCwdChange,
  resetTerminalCwdForwardingForTests,
} from "@main/ipc/terminal-cwd-forwarding.ts";

describe("handleTerminalCwdChange", () => {
  beforeEach(() => {
    resetTerminalCwdForwardingForTests();
    resolvePanelContextForPath.mockReset();
    recordRecentPanelContext.mockReset();
    peekTerminalPanelContext.mockReset();
    updateTerminalPanelContext.mockReset();
    forwardToWindow.mockReset();
    windowRecordIdFor.mockClear();
    peekTerminalPanelContext.mockReturnValue(null);
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c1",
      cwd: "/Users/xyz/ABC/loomdesk",
      projectRootPath: "/Users/xyz/ABC/loomdesk",
      updatedAt: 1,
    });
    recordRecentPanelContext.mockResolvedValue(undefined);
    updateTerminalPanelContext.mockResolvedValue(undefined);
  });

  it("resolves and forwards the first cwd for a panel", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", "/Users/xyz/ABC/loomdesk", win);
    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
    expect(updateTerminalPanelContext).toHaveBeenCalledTimes(1);
  });

  it("skips resolve and broadcast when OSC 7 repeats the same cwd", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", "/Users/xyz/ABC/loomdesk", win);
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();
    updateTerminalPanelContext.mockClear();
    recordRecentPanelContext.mockClear();
    peekTerminalPanelContext.mockReturnValue({
      cwd: "/Users/xyz/ABC/loomdesk",
    });

    await handleTerminalCwdChange(1, "term-1", "/Users/xyz/ABC/loomdesk", win);

    expect(resolvePanelContextForPath).not.toHaveBeenCalled();
    expect(forwardToWindow).not.toHaveBeenCalled();
    expect(updateTerminalPanelContext).not.toHaveBeenCalled();
    expect(recordRecentPanelContext).not.toHaveBeenCalled();
  });

  it("forwards again when the cwd actually changes", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", "/Users/xyz/ABC/loomdesk", win);
    peekTerminalPanelContext.mockReturnValue({
      cwd: "/Users/xyz/ABC/loomdesk",
    });
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c2",
      cwd: "/tmp/other",
      projectRootPath: "/tmp/other",
      updatedAt: 2,
    });

    await handleTerminalCwdChange(1, "term-1", "/tmp/other", win);

    expect(resolvePanelContextForPath).toHaveBeenCalledWith("/tmp/other", {
      source: "panel",
    });
    expect(forwardToWindow).toHaveBeenCalledTimes(2);
  });

  it("scopes same-cwd dedup per window so panel ids do not collide", async () => {
    windowRecordIdFor.mockReturnValueOnce("win-a").mockReturnValueOnce("win-b");
    const winA = { isDestroyed: () => false } as never;
    const winB = { isDestroyed: () => false } as never;

    await handleTerminalCwdChange(1, "term-1", "/Users/xyz/ABC/loomdesk", winA);
    peekTerminalPanelContext.mockReturnValue(null);
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();

    await handleTerminalCwdChange(2, "term-1", "/Users/xyz/ABC/loomdesk", winB);

    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
  });
});
