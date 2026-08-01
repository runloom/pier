import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewScope } from "@shared/contracts/git/review.ts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useGitChangesPanelIndexState } from "../../../../src/plugins/builtin/git/renderer/hooks/use-changes-panel-index-state.ts";
import { GitReviewMutationAuthority } from "../../../../src/plugins/builtin/git/renderer/review/mutation-authority.ts";

function source(contextId: string): GitReviewScope {
  return {
    contextId,
    gitRootPath: `/workspace/${contextId}`,
    target: { kind: "uncommitted" },
  };
}

it("旧 source 的延迟 acquire/ack 不能锁住或刷新新 source", async () => {
  const getReviewIndex = vi.fn(async (request) => ({
    entries: [],
    indexRevision: `index:${request.source.contextId}`,
    kind: "ok" as const,
    warnings: [],
  }));
  const context = {
    git: {
      cancelReviewRequest: vi.fn(async () => undefined),
      getReviewIndex,
      watch: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext;
  const sourceA = source("a");
  const sourceB = source("b");
  const authority = new GitReviewMutationAuthority();
  const hook = renderHook(
    ({ current }: { readonly current: GitReviewScope }) =>
      useGitChangesPanelIndexState({
        authority,
        context,
        source: current,
        sourceKey: JSON.stringify(current),
      }),
    { initialProps: { current: sourceA } }
  );
  await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(1));
  const acquireA = hook.result.current.acquireMutationAuthority;
  const commitA = hook.result.current.waitForAuthoritativeIndex;

  hook.rerender({ current: sourceB });
  await waitFor(() => expect(getReviewIndex).toHaveBeenCalledTimes(2));

  expect(acquireA()).toBe(false);
  await act(async () => {
    await commitA({ kind: "ok", operationId: "operation:a" });
  });
  expect(getReviewIndex).toHaveBeenCalledTimes(2);
  expect(hook.result.current.mutationAuthorityBlocked).toBe(false);
});

it("不可重试的权威刷新失败保持门禁，显式重新加载成功后才解除", async () => {
  const currentSource = source("a");
  const results = [
    {
      entries: [],
      indexRevision: "index:initial",
      kind: "ok" as const,
      warnings: [],
    },
    {
      kind: "error" as const,
      message: "invalid source after mutation",
      reason: "invalidSource" as const,
      retryable: false,
    },
    {
      entries: [],
      indexRevision: "index:recovered",
      kind: "ok" as const,
      warnings: [],
    },
  ];
  const getReviewIndex = vi.fn(async () => {
    const result = results.shift();
    if (result === undefined) {
      throw new Error("unexpected index request");
    }
    return result;
  });
  const context = {
    git: {
      cancelReviewRequest: vi.fn(async () => undefined),
      getReviewIndex,
      watch: vi.fn(() => vi.fn()),
    },
  } as unknown as RendererPluginContext;
  const authority = new GitReviewMutationAuthority();
  const hook = renderHook(() =>
    useGitChangesPanelIndexState({
      authority,
      context,
      source: currentSource,
      sourceKey: JSON.stringify(currentSource),
    })
  );
  await waitFor(() => expect(hook.result.current.state.kind).toBe("loaded"));
  expect(hook.result.current.acquireMutationAuthority()).toBe(true);

  let barrierSettled = false;
  const barrier = hook.result.current
    .waitForAuthoritativeIndex({
      kind: "ok",
      operationId: "operation:a",
    })
    .then(() => {
      barrierSettled = true;
    });
  await waitFor(() =>
    expect(hook.result.current.state).toMatchObject({
      kind: "loaded",
      refreshFailure: { reason: "invalidSource", retryable: false },
    })
  );
  expect(barrierSettled).toBe(false);
  expect(hook.result.current.mutationAuthorityBlocked).toBe(true);

  act(() => hook.result.current.retryIndex());
  await barrier;
  await waitFor(() => {
    expect(getReviewIndex).toHaveBeenCalledTimes(3);
    expect(hook.result.current.mutationAuthorityBlocked).toBe(false);
    expect(hook.result.current.state).toMatchObject({
      kind: "loaded",
      refreshFailure: null,
      result: { indexRevision: "index:recovered" },
    });
  });
});
