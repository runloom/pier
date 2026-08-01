import type {
  PierDiffViewItem,
  PierDiffViewProps,
} from "@pier/ui/diff-view/index.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReviewRenderFeedback } from "@plugins/builtin/git/renderer/review/code-view.tsx";
import { createReviewCodeView } from "@plugins/builtin/git/renderer/review/code-view.tsx";
import type { GitReviewIndexEntry } from "@shared/contracts/git/review.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

const context = {
  appearance: {
    current: () => ({
      codeTheme: "github-dark",
      codeThemes: { dark: "github-dark", light: "github-light" },
      density: "compact",
      language: "en",
      locale: "en",
      theme: "dark",
      typography: {
        baseFontSize: "16px",
        codeFontFamily: "monospace",
        codeFontSize: "13px",
        fontFamily: "sans-serif",
      },
    }),
    onDidChange: () => () => undefined,
  },
  i18n: {
    t: (_key: string, _values: unknown, fallback?: string) => fallback ?? "",
  },
} as unknown as RendererPluginContext;

afterEach(cleanup);

const acquireMutationAuthority = () => ({ minimumIndexGeneration: 1 });

it("Pierre 模块首次拒绝后显示错误，并在重试时重新加载成功", async () => {
  const LoadedDiffView = (_props: PierDiffViewProps) => (
    <output data-testid="loaded-pierre">loaded</output>
  );
  const load: Parameters<typeof createReviewCodeView>[0] = vi
    .fn()
    .mockRejectedValueOnce(new Error("chunk unavailable"))
    .mockResolvedValueOnce({ default: LoadedDiffView });
  const ReviewCodeView = createReviewCodeView(load);
  const feedbackRef: { current: ReviewRenderFeedback | null } = {
    current: null,
  };
  const view = render(
    <ReviewCodeView
      appearance={context.appearance.current()}
      context={context}
      contextId="test-context"
      diffRef={() => undefined}
      items={[]}
      mutationAuthorityBlocked={false}
      onAcquireMutationAuthority={acquireMutationAuthority}
      onFeedbackChange={(next) => {
        feedbackRef.current = next;
      }}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
      revisionBySectionId={new Map()}
    />
  );

  await waitFor(() =>
    expect(feedbackRef.current?.error.message).toBe("chunk unavailable")
  );
  expect(load).toHaveBeenCalledTimes(1);
  act(() => feedbackRef.current?.retry());
  await expect(view.findByTestId("loaded-pierre")).resolves.toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

it("appearance 变化会把最新代码主题传给 Pierre", async () => {
  const LoadedDiffView = (props: PierDiffViewProps) => (
    <output
      data-code-theme={
        props.appearance.colorMode === "light"
          ? props.appearance.codeThemes.light
          : props.appearance.codeThemes.dark
      }
      data-color-mode={props.appearance.colorMode}
      data-testid="loaded-pierre"
    />
  );
  const ReviewCodeView = createReviewCodeView(
    vi.fn().mockResolvedValue({ default: LoadedDiffView })
  );
  const view = render(
    <ReviewCodeView
      appearance={context.appearance.current()}
      context={context}
      contextId="test-context"
      diffRef={() => undefined}
      items={[]}
      mutationAuthorityBlocked={false}
      onAcquireMutationAuthority={acquireMutationAuthority}
      onFeedbackChange={() => undefined}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
      revisionBySectionId={new Map()}
    />
  );
  const output = await view.findByTestId("loaded-pierre");
  expect(output).toHaveAttribute("data-code-theme", "github-dark");

  view.rerender(
    <ReviewCodeView
      appearance={{
        ...context.appearance.current(),
        codeTheme: "github-light",
        codeThemes: { dark: "github-dark", light: "github-light" },
        theme: "light",
      }}
      context={context}
      contextId="test-context"
      diffRef={() => undefined}
      items={[]}
      mutationAuthorityBlocked={false}
      onAcquireMutationAuthority={acquireMutationAuthority}
      onFeedbackChange={() => undefined}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
      revisionBySectionId={new Map()}
    />
  );

  expect(output).toHaveAttribute("data-code-theme", "github-light");
  expect(output).toHaveAttribute("data-color-mode", "light");
});

it("运行时失败先卸载 Worker consumer，重试时再建立新实例", async () => {
  const unmounted = vi.fn();
  const LoadedDiffView = (props: PierDiffViewProps) => {
    useEffect(() => () => unmounted(), []);
    return (
      <button
        onClick={() => props.onError(new Error("worker setup failed"))}
        type="button"
      >
        Fail worker
      </button>
    );
  };
  const load = vi.fn().mockResolvedValue({ default: LoadedDiffView });
  const ReviewCodeView = createReviewCodeView(load);
  const feedbackRef: { current: ReviewRenderFeedback | null } = {
    current: null,
  };
  const view = render(
    <ReviewCodeView
      appearance={context.appearance.current()}
      context={context}
      contextId="test-context"
      diffRef={() => undefined}
      items={[]}
      mutationAuthorityBlocked={false}
      onAcquireMutationAuthority={acquireMutationAuthority}
      onFeedbackChange={(next) => {
        feedbackRef.current = next;
      }}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
      revisionBySectionId={new Map()}
    />
  );

  fireEvent.click(await view.findByRole("button", { name: "Fail worker" }));
  await waitFor(() => expect(unmounted).toHaveBeenCalledOnce());
  expect(view.queryByRole("button", { name: "Fail worker" })).toBeNull();
  expect(feedbackRef.current?.error.message).toBe("worker setup failed");

  act(() => feedbackRef.current?.retry());
  await expect(
    view.findByRole("button", { name: "Fail worker" })
  ).resolves.toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

it("全局 mutation 门禁期间保留操作按钮，只切换为禁用态", async () => {
  const LoadedDiffView = (props: PierDiffViewProps) => {
    const current = props.items[0];
    const change = current?.changeControls?.[0];
    return (
      <div data-testid="loaded-pierre">
        {props.onToggleStage ? (
          <button disabled={current?.stageControl?.busy} type="button">
            Stage
          </button>
        ) : null}
        {props.onHunkAction ? (
          <button disabled={change?.busy} type="button">
            Stage hunk
          </button>
        ) : null}
        {props.onDiscardFile ? (
          <button disabled={current?.stageControl?.busy} type="button">
            Revert
          </button>
        ) : null}
      </div>
    );
  };
  const ReviewCodeView = createReviewCodeView(
    vi.fn().mockResolvedValue({ default: LoadedDiffView })
  );
  const entry: GitReviewIndexEntry = {
    entryKey: "entry:a",
    oldPaths: [],
    path: "src/a.ts",
    renderSlots: [
      {
        group: "unstaged",
        oldPath: null,
        sectionKey: "section:a",
        status: "modified",
        targetPath: "src/a.ts",
      },
    ],
    status: "modified",
  };
  const item: PierDiffViewItem = {
    cacheKey: "revision:a",
    changeControls: [
      {
        canRevert: true,
        changeBlockIndex: 0,
        changeKey: `sha256:${"a".repeat(64)}`,
        hunkIndex: 0,
        state: "unstaged",
      },
    ],
    id: "section:a",
    patch: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
    stageControl: { canDiscard: true, state: "unstaged" },
  };
  const renderCodeView = (mutationAuthorityBlocked: boolean) => (
    <ReviewCodeView
      appearance={context.appearance.current()}
      context={context}
      contextId="test-context"
      diffRef={() => undefined}
      entries={[entry]}
      gitRootPath="/workspace/pier"
      items={[item]}
      mutationAuthorityBlocked={mutationAuthorityBlocked}
      onAcquireMutationAuthority={acquireMutationAuthority}
      onFeedbackChange={() => undefined}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
      revisionBySectionId={new Map([[item.id, "revision:a"]])}
    />
  );
  const view = render(renderCodeView(false));

  await expect(
    view.findByRole("button", { name: "Stage" })
  ).resolves.toBeEnabled();
  expect(view.getByRole("button", { name: "Stage hunk" })).toBeEnabled();
  expect(view.getByRole("button", { name: "Revert" })).toBeEnabled();

  view.rerender(renderCodeView(true));
  await waitFor(() => {
    const mutationBarrier = view.container.querySelector(
      '[data-git-review-mutation-blocked="true"]'
    );
    expect(mutationBarrier).not.toHaveAttribute("inert");
    expect(mutationBarrier).toHaveAttribute("disabled");
    expect(view.getByRole("button", { name: "Stage" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Stage hunk" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Revert" })).toBeDisabled();
  });
});
