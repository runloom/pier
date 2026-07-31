import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReviewFailedResource } from "@plugins/builtin/git/renderer/review/document/generation.ts";
import {
  ReviewErrorEmpty,
  ReviewFailureEmpty,
  ReviewFeedback,
  ReviewLoading,
} from "@plugins/builtin/git/renderer/review/feedback.tsx";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const notifyError = vi.fn();
const context = {
  dialogs: {
    alert: vi.fn(async () => undefined),
  },
  i18n: {
    t: vi.fn((_key: string, values?: unknown, fallback = "") => {
      if (!(values && typeof values === "object")) {
        return fallback;
      }
      return Object.entries(values).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        fallback
      );
    }),
  },
  notifications: {
    error: notifyError,
  },
} as unknown as RendererPluginContext;

function entry(index: number) {
  const path = `very/long/path/${index}/file.ts`;
  return {
    entryKey: `entry:${index}`,
    oldPaths: [],
    path,
    renderSlots: [
      {
        group: "unstaged" as const,
        oldPath: null,
        sectionKey: `section:${index}`,
        status: "modified" as const,
        targetPath: path,
      },
    ],
    status: "modified" as const,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Git Review feedback", () => {
  it("加载骨架向读屏器提供本地化状态名称", () => {
    render(<ReviewLoading context={context} />);

    expect(
      screen.getByRole("status", { name: "Loading changes" })
    ).toBeVisible();
  });

  it("错误主体状态用 Empty 呈现,技术详情走 Details 对话框", () => {
    const onRetry = vi.fn();
    render(
      <ReviewErrorEmpty
        context={context}
        description="short summary"
        detail="raw diagnostic"
        onRetry={onRetry}
        title="Failed to load changes"
      />
    );

    const empty = screen
      .getByText("Failed to load changes")
      .closest('[data-slot="error-empty"]');
    expect(empty).toBeVisible();
    expect(screen.getByText("short summary")).toBeVisible();
    expect(screen.queryByText("raw diagnostic")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: "raw diagnostic",
      title: "Failed to load changes",
    });
  });

  it("不可重试的失败 Empty 不渲染 Retry 按钮", () => {
    render(
      <ReviewFailureEmpty
        context={context}
        failure={{
          kind: "error",
          message: "fatal detail",
          reason: "commandFailed",
          retryable: false,
        }}
        onRetry={vi.fn()}
        title="Failed to load changes"
      />
    );

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeVisible();
  });

  it("已有正文时的 index 刷新失败只发一次 toast，详情走对话框且不插入 Alert", () => {
    const failure = {
      kind: "error" as const,
      message: "invalid source after mutation",
      reason: "invalidSource" as const,
      retryable: false,
    };
    const view = render(
      <ReviewFeedback context={context} failures={[]} indexFailure={failure} />
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container).toBeEmptyDOMElement();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith(
      "Failed to refresh changes",
      expect.objectContaining({
        action: {
          label: "Details",
          onClick: expect.any(Function),
        },
      })
    );

    view.rerender(
      <ReviewFeedback context={context} failures={[]} indexFailure={failure} />
    );
    expect(notifyError).toHaveBeenCalledTimes(1);

    const notificationOptions = notifyError.mock.calls[0]?.[1];
    notificationOptions?.action?.onClick();
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: "invalid source after mutation",
      title: "Failed to refresh changes",
    });
  });

  it("刷新恢复后，同一错误再次发生会重新提示", () => {
    const failure = {
      kind: "error" as const,
      message: "index diagnostic",
      reason: "commandFailed" as const,
      retryable: true,
    };
    const view = render(
      <ReviewFeedback context={context} failures={[]} indexFailure={failure} />
    );
    expect(notifyError).toHaveBeenCalledTimes(1);

    view.rerender(<ReviewFeedback context={context} failures={[]} />);
    view.rerender(
      <ReviewFeedback context={context} failures={[]} indexFailure={failure} />
    );

    expect(notifyError).toHaveBeenCalledTimes(2);
  });

  it("渲染失败走可重试 toast，不插入顶部 Alert", () => {
    const onRetryRender = vi.fn();
    const view = render(
      <ReviewFeedback
        context={context}
        failures={[]}
        onRetryRender={onRetryRender}
        runtimeError={new Error("render diagnostic")}
      />
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(notifyError).toHaveBeenCalledWith("Failed to render diff", {
      action: {
        label: "Retry",
        onClick: onRetryRender,
      },
    });
  });

  it("隐藏阅读面不投递反馈，切为活动面后只投递一次", () => {
    const failure = {
      kind: "error" as const,
      message: "index diagnostic",
      reason: "commandFailed" as const,
      retryable: true,
    };
    const onRetryIndex = vi.fn();
    const view = render(
      <ReviewFeedback
        context={context}
        enabled={false}
        failures={[]}
        indexFailure={failure}
        onRetryIndex={onRetryIndex}
      />
    );
    expect(notifyError).not.toHaveBeenCalled();

    view.rerender(
      <ReviewFeedback
        context={context}
        failures={[]}
        indexFailure={failure}
        onRetryIndex={onRetryIndex}
      />
    );

    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("同一文档失败周期只投递一次，Retry 使用点击时的最新失败集合", () => {
    const onRetryFailure = vi.fn();
    const firstFailure = {
      entry: entry(0),
      failure: {
        kind: "error" as const,
        message: "first",
        reason: "commandFailed" as const,
        retryable: true,
      },
      kind: "error" as const,
    } satisfies ReviewFailedResource;
    const secondFailure = {
      entry: entry(1),
      failure: {
        kind: "error" as const,
        message: "second",
        reason: "commandFailed" as const,
        retryable: true,
      },
      kind: "error" as const,
    } satisfies ReviewFailedResource;
    const view = render(
      <ReviewFeedback
        context={context}
        failures={[firstFailure]}
        onRetryFailure={onRetryFailure}
      />
    );
    view.rerender(
      <ReviewFeedback
        context={context}
        failures={[firstFailure, secondFailure]}
        onRetryFailure={onRetryFailure}
      />
    );

    expect(notifyError).toHaveBeenCalledTimes(1);
    const notificationOptions = notifyError.mock.calls[0]?.[1];
    notificationOptions?.action?.onClick();
    expect(onRetryFailure).toHaveBeenNthCalledWith(1, "entry:0");
    expect(onRetryFailure).toHaveBeenNthCalledWith(2, "entry:1");
  });

  it("文件加载失败由对应文件项承载，不在正文顶部重复堆叠", () => {
    const failures = Array.from({ length: 7 }, (_, index) => ({
      entry: entry(index),
      failure: {
        kind: "error" as const,
        message: "main diagnostic must not be shown",
        reason: "commandFailed" as const,
        retryable: true,
      },
      kind: "error" as const,
    })) satisfies readonly ReviewFailedResource[];
    const view = render(
      <ReviewFeedback
        context={context}
        failures={failures.slice(0, 5)}
        hasHiddenFailures
        indexFailure={{
          kind: "error",
          message: "index diagnostic",
          reason: "commandFailed",
          retryable: true,
        }}
        onRetryFailure={vi.fn()}
        onRetryIndex={vi.fn()}
        onRetryRender={vi.fn()}
        runtimeError={new Error("render diagnostic")}
        staleRetainedCount={2}
      />
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(notifyError).toHaveBeenCalledTimes(3);
    expect(notifyError).toHaveBeenCalledWith(
      "Additional changes could not be displayed.",
      {
        action: {
          label: "Retry",
          onClick: expect.any(Function),
        },
      }
    );
  });
});
