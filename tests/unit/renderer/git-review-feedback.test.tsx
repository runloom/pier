import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { ReviewFailedResource } from "@plugins/builtin/git/renderer/git-review-document-generation.ts";
import {
  ReviewErrorEmpty,
  ReviewFailureEmpty,
  ReviewFeedback,
  ReviewLoading,
} from "@plugins/builtin/git/renderer/git-review-feedback.tsx";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("文件加载失败最多显示五项，技术详情不内联并保留高度边界", () => {
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

    expect(view.container.firstElementChild).toHaveClass(
      "max-h-[40%]",
      "shrink-0"
    );
    expect(screen.getAllByRole("alert")).toHaveLength(9);
    expect(
      screen.queryByText("3 more files will load when selected.")
    ).toBeNull();
    expect(
      screen.getByText("Additional changes could not be displayed.")
    ).toBeVisible();
    expect(screen.queryByText("main diagnostic must not be shown")).toBeNull();
    const resourceTitle = screen.getByText("very/long/path/0/file.ts");
    const resourceAlert = resourceTitle.closest('[role="alert"]');
    if (!(resourceAlert instanceof HTMLElement)) {
      throw new Error("missing resource alert");
    }
    fireEvent.click(
      within(resourceAlert).getByRole("button", { name: "Details" })
    );
    expect(context.dialogs.alert).toHaveBeenCalledWith({
      body: "main diagnostic must not be shown",
      title: "very/long/path/0/file.ts",
    });
    expect(screen.getAllByText(/very\/long\/path/u)[0]).toHaveClass(
      "break-all",
      "font-mono"
    );
  });
});
