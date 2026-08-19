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
const notifyInfo = vi.fn();
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
    info: notifyInfo,
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

function documentFailure(
  index: number,
  reason: ReviewFailedResource["failure"]["reason"] = "commandFailed"
): ReviewFailedResource {
  return {
    entry: entry(index),
    failure: {
      kind: "error",
      message: `diagnostic-${index}`,
      reason,
      retryable: true,
    },
    kind: "error",
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

  it("暂存区锁争用 Empty 不展示 Git 删锁说明书", () => {
    render(
      <ReviewFailureEmpty
        context={context}
        failure={{
          kind: "error",
          message:
            "fatal: Unable to create '/repo/.git/index.lock': File exists.",
          reason: "indexLocked",
          retryable: true,
        }}
        onRetry={vi.fn()}
        title="Failed to load changes"
      />
    );

    expect(
      screen.getByText(
        "Another program is updating the Git staging area. Try again in a moment."
      )
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByText(/index\.lock/)).toBeNull();
  });

  it("背景 index 刷新失败不弹全局 toast（有 last-good 时静默）", () => {
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
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("渲染失败不弹全局 toast（由面板内 Empty 承担）", () => {
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
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("文档加载失败不弹全局 toast（行内 error 槽承担）", () => {
    const onRetryFailure = vi.fn();
    render(
      <ReviewFeedback
        context={context}
        failures={[documentFailure(0), documentFailure(1)]}
        onRetryFailure={onRetryFailure}
      />
    );

    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("stage/watch 竞态失败（staleRevision 等）不弹全局 toast", () => {
    render(
      <ReviewFeedback
        context={context}
        failures={[documentFailure(0, "staleRevision")]}
        onRetryFailure={vi.fn()}
      />
    );

    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("soft-retain 刷新失败不弹 info/error toast", () => {
    render(
      <ReviewFeedback
        context={context}
        failures={[documentFailure(0, "internal")]}
        onRetryFailure={vi.fn()}
        softRetainedOnly
      />
    );

    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("document + runtime + index 同帧失败仍零 toast", () => {
    const failures = Array.from({ length: 5 }, (_, index) =>
      documentFailure(index)
    );
    const view = render(
      <ReviewFeedback
        context={context}
        failures={failures}
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
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("隐藏阅读面与活动面均不因背景失败投递 toast", () => {
    const failure = {
      kind: "error" as const,
      message: "index diagnostic",
      reason: "commandFailed" as const,
      retryable: true,
    };
    const view = render(
      <ReviewFeedback
        context={context}
        enabled={false}
        failures={[documentFailure(0)]}
        indexFailure={failure}
        runtimeError={new Error("render")}
      />
    );
    expect(notifyError).not.toHaveBeenCalled();

    view.rerender(
      <ReviewFeedback
        context={context}
        failures={[documentFailure(0)]}
        indexFailure={failure}
        runtimeError={new Error("render")}
      />
    );
    expect(notifyError).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});
