import { beforeEach, describe, expect, it, vi } from "vitest";

const resolvePanelContextForPath = vi.fn();
const recordRecentPanelContext = vi.fn();
const peekTerminalPanelContext = vi.fn();
const updateTerminalPanelContext = vi.fn();
const forwardToWindow = vi.fn();
const windowRecordIdFor = vi.fn(() => "win-1");
const syncGitIdentityDiscovery = vi.fn();
const releaseGitIdentityDiscovery = vi.fn();
const retainGitIdentityDiscovery = vi.fn();
const resetGitIdentityDiscoveryForTests = vi.fn();

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
vi.mock("@main/ipc/terminal/forwarding.ts", () => ({
  forwardToWindow: (...args: unknown[]) => forwardToWindow(...args),
}));
vi.mock("@main/ipc/terminal/window-scope.ts", () => ({
  windowRecordIdFor: () => windowRecordIdFor(),
}));
vi.mock("@main/services/git/identity-discovery.ts", () => ({
  releaseGitIdentityDiscovery: (...args: unknown[]) =>
    releaseGitIdentityDiscovery(...args),
  resetGitIdentityDiscoveryForTests: (...args: unknown[]) =>
    resetGitIdentityDiscoveryForTests(...args),
  retainGitIdentityDiscovery: (...args: unknown[]) =>
    retainGitIdentityDiscovery(...args),
  syncGitIdentityDiscovery: (...args: unknown[]) =>
    syncGitIdentityDiscovery(...args),
}));

import {
  handleTerminalCwdChange,
  releaseTerminalCwdForwarding,
  resetTerminalCwdForwardingForTests,
  retainTerminalCwdForwarding,
} from "@main/ipc/terminal/cwd-forwarding.ts";

const CWD = "/Users/xyz/ABC/loomdesk";
const OTHER = "/tmp/other";

function lastDiscoveryInput(): {
  onDirty?: () => void;
  onInvalidate?: () => void | Promise<void>;
} {
  return (syncGitIdentityDiscovery.mock.calls.at(-1)?.[1] ?? {}) as {
    onDirty?: () => void;
    onInvalidate?: () => void | Promise<void>;
  };
}

describe("handleTerminalCwdChange", () => {
  beforeEach(() => {
    resetTerminalCwdForwardingForTests();
    resolvePanelContextForPath.mockReset();
    recordRecentPanelContext.mockReset();
    peekTerminalPanelContext.mockReset();
    updateTerminalPanelContext.mockReset();
    forwardToWindow.mockReset();
    windowRecordIdFor.mockClear();
    syncGitIdentityDiscovery.mockReset();
    releaseGitIdentityDiscovery.mockReset();
    retainGitIdentityDiscovery.mockReset();
    peekTerminalPanelContext.mockReturnValue(null);
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c1",
      cwd: CWD,
      projectRootPath: CWD,
      updatedAt: 1,
    });
    recordRecentPanelContext.mockResolvedValue(undefined);
    updateTerminalPanelContext.mockResolvedValue(undefined);
  });

  it("resolves and forwards the first cwd for a panel", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
    expect(updateTerminalPanelContext).toHaveBeenCalledTimes(1);
    expect(syncGitIdentityDiscovery).toHaveBeenCalled();
  });

  it("skips resolve and broadcast when OSC 7 repeats the same cwd", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();
    updateTerminalPanelContext.mockClear();
    recordRecentPanelContext.mockClear();
    peekTerminalPanelContext.mockReturnValue({
      cwd: CWD,
    });

    await handleTerminalCwdChange(1, "term-1", CWD, win);

    expect(resolvePanelContextForPath).not.toHaveBeenCalled();
    expect(forwardToWindow).not.toHaveBeenCalled();
    expect(updateTerminalPanelContext).not.toHaveBeenCalled();
    expect(recordRecentPanelContext).not.toHaveBeenCalled();
  });

  it("skips same-cwd re-resolve once git identity is settled this session", async () => {
    const win = { isDestroyed: () => false } as never;
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c-git",
      cwd: CWD,
      gitRoot: CWD,
      projectRootPath: CWD,
      updatedAt: 1,
      worktreeRoot: CWD,
    });
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();

    await handleTerminalCwdChange(1, "term-1", CWD, win);

    expect(resolvePanelContextForPath).not.toHaveBeenCalled();
    expect(forwardToWindow).not.toHaveBeenCalled();
  });

  it("re-resolves same cwd when onDirty runs before the next OSC 7", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    lastDiscoveryInput().onDirty?.();
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();
    updateTerminalPanelContext.mockClear();
    recordRecentPanelContext.mockClear();
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c-git",
      cwd: CWD,
      gitRoot: CWD,
      projectRootPath: CWD,
      updatedAt: 2,
      worktreeRoot: CWD,
    });

    await handleTerminalCwdChange(1, "term-1", CWD, win);

    expect(resolvePanelContextForPath).toHaveBeenCalledWith(CWD, {
      source: "panel",
    });
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
  });

  it("re-resolves same cwd when discovery invalidates git identity", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    const { onDirty, onInvalidate } = lastDiscoveryInput();
    expect(onInvalidate).toBeTypeOf("function");
    onDirty?.();
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();
    updateTerminalPanelContext.mockClear();
    recordRecentPanelContext.mockClear();
    peekTerminalPanelContext.mockReturnValue({
      cwd: CWD,
    });
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c-git",
      cwd: CWD,
      gitRoot: CWD,
      projectRootPath: CWD,
      updatedAt: 2,
      worktreeRoot: CWD,
    });

    await onInvalidate?.();
    expect(resolvePanelContextForPath).toHaveBeenCalledWith(CWD, {
      source: "panel",
    });
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
    expect(updateTerminalPanelContext).toHaveBeenCalledTimes(1);
    expect(recordRecentPanelContext).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast when invalidation re-resolve keeps the same identity digest", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    const { onDirty, onInvalidate } = lastDiscoveryInput();
    onDirty?.();
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c1-again",
      cwd: CWD,
      projectRootPath: CWD,
      updatedAt: 99,
    });

    await onInvalidate?.();
    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).not.toHaveBeenCalled();
  });

  it("invalidates against the latest cwd, not the closure from an earlier handle", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c2",
      cwd: OTHER,
      projectRootPath: OTHER,
      updatedAt: 2,
    });
    await handleTerminalCwdChange(1, "term-1", OTHER, win);
    const { onDirty, onInvalidate } = lastDiscoveryInput();
    onDirty?.();
    resolvePanelContextForPath.mockClear();
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c2-git",
      cwd: OTHER,
      gitRoot: OTHER,
      projectRootPath: OTHER,
      updatedAt: 3,
    });

    await onInvalidate?.();

    expect(resolvePanelContextForPath).toHaveBeenCalledWith(OTHER, {
      source: "panel",
    });
  });

  it("discards an in-flight resolve after the panel is released", async () => {
    const win = { isDestroyed: () => false } as never;
    let finish: ((value: unknown) => void) | undefined;
    resolvePanelContextForPath.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = handleTerminalCwdChange(1, "term-1", CWD, win);
    releaseTerminalCwdForwarding("win-1", 1, "term-1");
    finish?.({
      contextId: "stale",
      cwd: CWD,
      gitRoot: CWD,
      projectRootPath: CWD,
      updatedAt: 1,
    });
    await pending;
    expect(forwardToWindow).not.toHaveBeenCalled();
  });

  it("retains live scopes including in-flight resolves without an emitted digest", async () => {
    const win = { isDestroyed: () => false } as never;
    let finish: ((value: unknown) => void) | undefined;
    resolvePanelContextForPath.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = handleTerminalCwdChange(1, "term-1", CWD, win);
    retainTerminalCwdForwarding("win-1", ["term-2"]);
    finish?.({
      contextId: "dropped",
      cwd: CWD,
      gitRoot: CWD,
      projectRootPath: CWD,
      updatedAt: 1,
    });
    await pending;
    expect(forwardToWindow).not.toHaveBeenCalled();
    expect(retainGitIdentityDiscovery).toHaveBeenCalledWith("win-1", [
      "term-2",
    ]);
  });

  it("retries after a failed broadcast instead of treating identity as settled", async () => {
    const win = { isDestroyed: () => false } as never;
    forwardToWindow.mockImplementationOnce(() => {
      throw new Error("window gone");
    });
    await expect(
      handleTerminalCwdChange(1, "term-1", CWD, win)
    ).rejects.toThrow("window gone");
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    expect(forwardToWindow).toHaveBeenCalledTimes(2);
  });

  it("retries a failed broadcast even when session peek already matches the new digest", async () => {
    const win = { isDestroyed: () => false } as never;
    const context = {
      contextId: "c1",
      cwd: CWD,
      projectRootPath: CWD,
      updatedAt: 1,
    };
    resolvePanelContextForPath.mockResolvedValue(context);
    forwardToWindow.mockImplementationOnce(() => {
      throw new Error("window gone");
    });
    await expect(
      handleTerminalCwdChange(1, "term-1", CWD, win)
    ).rejects.toThrow("window gone");
    peekTerminalPanelContext.mockReturnValue(context);
    resolvePanelContextForPath.mockClear();
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).toHaveBeenCalledTimes(2);
  });

  it("forwards again when the cwd actually changes", async () => {
    const win = { isDestroyed: () => false } as never;
    await handleTerminalCwdChange(1, "term-1", CWD, win);
    peekTerminalPanelContext.mockReturnValue({
      cwd: CWD,
    });
    resolvePanelContextForPath.mockResolvedValue({
      contextId: "c2",
      cwd: OTHER,
      projectRootPath: OTHER,
      updatedAt: 2,
    });

    await handleTerminalCwdChange(1, "term-1", OTHER, win);

    expect(resolvePanelContextForPath).toHaveBeenCalledWith(OTHER, {
      source: "panel",
    });
    expect(forwardToWindow).toHaveBeenCalledTimes(2);
  });

  it("scopes same-cwd dedup per window so panel ids do not collide", async () => {
    windowRecordIdFor.mockReturnValueOnce("win-a").mockReturnValueOnce("win-b");
    const winA = { isDestroyed: () => false } as never;
    const winB = { isDestroyed: () => false } as never;

    await handleTerminalCwdChange(1, "term-1", CWD, winA);
    peekTerminalPanelContext.mockReturnValue(null);
    resolvePanelContextForPath.mockClear();
    forwardToWindow.mockClear();

    await handleTerminalCwdChange(2, "term-1", CWD, winB);

    expect(resolvePanelContextForPath).toHaveBeenCalledTimes(1);
    expect(forwardToWindow).toHaveBeenCalledTimes(1);
  });

  it("releases discovery for the session key and the bw fallback key", () => {
    releaseTerminalCwdForwarding("win-1", 1, "term-1");
    expect(releaseGitIdentityDiscovery).toHaveBeenCalledWith("win-1::term-1");
    expect(releaseGitIdentityDiscovery).toHaveBeenCalledWith("bw:1::term-1");
  });

  it("retains discovery for live panels only", () => {
    retainTerminalCwdForwarding("win-1", ["term-2"]);
    expect(retainGitIdentityDiscovery).toHaveBeenCalledWith("win-1", [
      "term-2",
    ]);
  });
});
