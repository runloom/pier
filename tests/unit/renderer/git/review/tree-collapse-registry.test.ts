import {
  collapseGitReviewTreeFolders,
  expandGitReviewTreeFolders,
  registerGitReviewTreeFolderHandlers,
} from "@plugins/builtin/git/renderer/review/tree-collapse-registry.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

type HandlerOptions = Parameters<typeof registerGitReviewTreeFolderHandlers>[0];

const disposers: (() => void)[] = [];

function register(options: HandlerOptions): void {
  disposers.push(registerGitReviewTreeFolderHandlers(options));
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  vi.useRealTimers();
});

describe("git review tree folder dispatch", () => {
  it("prefers the panel over a shared review scope", async () => {
    const panelA = vi.fn(() => true);
    const panelB = vi.fn(() => true);
    register({
      collapseAll: panelA,
      contextId: "ctx-shared",
      expandAll: panelA,
      panelId: "panel-a",
    });
    register({
      collapseAll: panelB,
      contextId: "ctx-shared",
      expandAll: panelB,
      panelId: "panel-b",
    });

    await expect(
      expandGitReviewTreeFolders(undefined, {
        contextId: "ctx-shared",
        panelId: "panel-a",
      })
    ).resolves.toBe(true);

    expect(panelA).toHaveBeenCalledTimes(1);
    expect(panelB).not.toHaveBeenCalled();
  });

  it("falls back to the scope when the registration has no panel id", async () => {
    const expandAll = vi.fn(() => true);
    register({ collapseAll: () => false, contextId: "ctx-a", expandAll });

    await expect(
      expandGitReviewTreeFolders(undefined, {
        contextId: "ctx-a",
        panelId: "panel-missing",
      })
    ).resolves.toBe(true);

    expect(expandAll).toHaveBeenCalledTimes(1);
  });

  it("does not drive another tree when the owning panel is gone", async () => {
    const expandAll = vi.fn(() => true);
    register({ collapseAll: () => false, expandAll, panelId: "panel-b" });

    await expect(
      expandGitReviewTreeFolders(undefined, { panelId: "panel-a" })
    ).resolves.toBe(false);

    expect(expandAll).not.toHaveBeenCalled();
  });

  it("falls back to the most recent tree for ownerless invocations", async () => {
    const expandAll = vi.fn(() => true);
    register({ collapseAll: () => false, expandAll, panelId: "panel-a" });

    await expect(expandGitReviewTreeFolders()).resolves.toBe(true);

    expect(expandAll).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the panel unmounts", async () => {
    const expandAll = vi.fn(() => false);
    register({ collapseAll: () => false, expandAll, panelId: "panel-a" });

    const result = expandGitReviewTreeFolders(undefined, {
      panelId: "panel-a",
    });
    for (const dispose of disposers.splice(0)) {
      dispose();
    }

    await expect(result).resolves.toBe(false);
    expect(expandAll).not.toHaveBeenCalled();
  });

  it("re-resolves the handler while retrying across a remount", async () => {
    vi.useFakeTimers();
    const stale = vi.fn(() => false);
    register({
      collapseAll: () => false,
      expandAll: stale,
      panelId: "panel-a",
    });

    const result = expandGitReviewTreeFolders(undefined, {
      panelId: "panel-a",
    });
    // First attempt (t=0) and first retry (t=16) hit the stale handler.
    await vi.advanceTimersByTimeAsync(16);

    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    const fresh = vi.fn(() => true);
    register({
      collapseAll: () => false,
      expandAll: fresh,
      panelId: "panel-a",
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(true);
    expect(stale).toHaveBeenCalledTimes(2);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget", async () => {
    vi.useFakeTimers();
    const expandAll = vi.fn(() => false);
    register({ collapseAll: () => false, expandAll, panelId: "panel-a" });

    const result = expandGitReviewTreeFolders(undefined, {
      panelId: "panel-a",
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(false);
    expect(expandAll).toHaveBeenCalledTimes(5);
  });

  it("keeps invocation order when an earlier action is retrying", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const collapseAll = vi.fn(() => {
      events.push("collapse");
      return events.filter((event) => event === "collapse").length > 1;
    });
    const expandAll = vi.fn(() => {
      events.push("expand");
      return true;
    });
    register({ collapseAll, expandAll, panelId: "panel-a" });

    const collapsed = collapseGitReviewTreeFolders(undefined, {
      panelId: "panel-a",
    });
    const expanded = expandGitReviewTreeFolders(undefined, {
      panelId: "panel-a",
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(collapsed).resolves.toBe(true);
    await expect(expanded).resolves.toBe(true);
    expect(events).toEqual(["collapse", "collapse", "expand"]);
  });
});
