import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canSkipWorkspaceLayoutFlushForInitialClose,
  flushWorkspaceLayout,
  markWorkspaceLayoutPersistenceStarting,
  markWorkspaceLayoutPersistenceUnavailable,
  registerWorkspaceLayoutFlusher,
  resetWorkspaceLayoutPersistenceForTests,
  type WorkspaceLayoutPersistenceError,
} from "@/lib/workspace/workspace-layout-persistence.ts";

describe("workspace layout persistence readiness", () => {
  afterEach(() => {
    resetWorkspaceLayoutPersistenceForTests();
    vi.restoreAllMocks();
  });

  it("allows close before the workspace has ever owned editable layout state", () => {
    expect(canSkipWorkspaceLayoutFlushForInitialClose()).toBe(true);
    const dispose = registerWorkspaceLayoutFlusher(async () => undefined);
    dispose();

    expect(canSkipWorkspaceLayoutFlushForInitialClose()).toBe(false);
  });

  it("returns a retryable failure immediately while Dockview is starting", async () => {
    markWorkspaceLayoutPersistenceStarting();

    await expect(flushWorkspaceLayout()).rejects.toMatchObject({
      code: "platform_unavailable",
      state: "starting",
    } satisfies Partial<WorkspaceLayoutPersistenceError>);
  });

  it("flushes only through the active registration", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const disposeFirst = registerWorkspaceLayoutFlusher(first);
    const disposeSecond = registerWorkspaceLayoutFlusher(second);

    disposeFirst();
    await flushWorkspaceLayout();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
  });

  it("fails immediately after WorkspaceHost unmounts", async () => {
    const flusher = vi.fn(async () => undefined);
    const dispose = registerWorkspaceLayoutFlusher(flusher);
    dispose();
    markWorkspaceLayoutPersistenceUnavailable();

    await expect(flushWorkspaceLayout()).rejects.toMatchObject({
      code: "platform_unavailable",
      state: "unavailable",
    } satisfies Partial<WorkspaceLayoutPersistenceError>);
    expect(flusher).not.toHaveBeenCalled();
  });

  it("returns to starting when a workspace remount begins", async () => {
    markWorkspaceLayoutPersistenceUnavailable();
    markWorkspaceLayoutPersistenceStarting();

    await expect(flushWorkspaceLayout()).rejects.toMatchObject({
      code: "platform_unavailable",
      state: "starting",
    } satisfies Partial<WorkspaceLayoutPersistenceError>);
  });
});
