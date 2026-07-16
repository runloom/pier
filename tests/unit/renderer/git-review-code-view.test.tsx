import type { PierDiffViewProps } from "@pier/ui/diff-view.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReviewRenderFeedback } from "@plugins/builtin/git/renderer/git-review-code-view.tsx";
import { createReviewCodeView } from "@plugins/builtin/git/renderer/git-review-code-view.tsx";
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
      density: "compact",
      language: "en",
      locale: "en",
      theme: "dark",
      typography: {
        baseFontSize: "16px",
        codeFontFamily: "monospace",
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
      diffRef={() => undefined}
      items={[]}
      onFeedbackChange={(next) => {
        feedbackRef.current = next;
      }}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
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
      data-code-theme={props.appearance.codeTheme}
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
      diffRef={() => undefined}
      items={[]}
      onFeedbackChange={() => undefined}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
    />
  );
  const output = await view.findByTestId("loaded-pierre");
  expect(output).toHaveAttribute("data-code-theme", "github-dark");

  view.rerender(
    <ReviewCodeView
      appearance={{
        ...context.appearance.current(),
        codeTheme: "github-light",
        theme: "light",
      }}
      context={context}
      diffRef={() => undefined}
      items={[]}
      onFeedbackChange={() => undefined}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
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
      diffRef={() => undefined}
      items={[]}
      onFeedbackChange={(next) => {
        feedbackRef.current = next;
      }}
      onRenderWindowChange={() => undefined}
      onScroll={() => undefined}
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
