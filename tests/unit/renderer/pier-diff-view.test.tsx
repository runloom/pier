import {
  PierDiffView,
  type PierDiffViewHandle,
  type PierDiffViewItem,
} from "@pier/ui/diff-view.tsx";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, startTransition, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodeView as PierreCodeView,
  FileDiff as PierreFileDiff,
} from "../../../packages/ui/node_modules/@pierre/diffs/dist/index.js";
import { WorkerPoolManager } from "../../../packages/ui/node_modules/@pierre/diffs/dist/worker/index.js";
import { useDiffRenderWatchdog } from "../../../packages/ui/src/diff-view-render-watchdog.ts";

interface TestWorkerRequest {
  readonly id: string;
  readonly renderTheme?: unknown;
  readonly type: string;
}

const workers: TestWorker[] = [];
const workerConstructionOptions: (WorkerOptions | undefined)[] = [];

function readRequest(value: unknown): TestWorkerRequest | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    renderTheme:
      "renderOptions" in value &&
      value.renderOptions &&
      typeof value.renderOptions === "object" &&
      "theme" in value.renderOptions
        ? value.renderOptions.theme
        : undefined,
    type: value.type,
  };
}

class TestWorker extends EventTarget {
  readonly requests: TestWorkerRequest[] = [];

  postMessage(value: unknown): void {
    const request = readRequest(value);
    if (!request) {
      return;
    }
    this.requests.push(request);
    if (
      request.type !== "initialize" &&
      request.type !== "set-render-options"
    ) {
      return;
    }
    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: request.id,
            requestType: request.type,
            sentAt: Date.now(),
            type: "success",
          },
        })
      );
    });
  }

  readonly terminate = vi.fn();
}

const appearance = {
  baseFontSize: "16px",
  codeFontFamily: "monospace",
  codeTheme: "github-dark",
  colorMode: "dark",
} as const;

const labels = {
  collapseDiff: "Collapse diff",
  expandDiff: "Expand diff",
} as const;

const items = [
  {
    cacheKey: "revision:file.ts",
    id: "file.ts",
    patch:
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
  },
] as const;

const poolSize = Math.min(
  Math.max(1, (navigator.hardwareConcurrency ?? 1) - 1),
  3
);

beforeEach(() => {
  workers.length = 0;
  workerConstructionOptions.length = 0;
  vi.stubGlobal(
    "Worker",
    class extends TestWorker {
      constructor(_url: URL, options?: WorkerOptions) {
        super();
        workers.push(this);
        workerConstructionOptions.push(options);
      }
    }
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PierDiffView", () => {
  it("按官方 rendered window 区分真实可见项与缓冲项", async () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = vi.fn(() => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      toJSON: () => undefined,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    }));
    const visibleElement = document.createElement("diffs-container");
    visibleElement.getBoundingClientRect = vi.fn(() => ({
      bottom: 40,
      height: 40,
      left: 0,
      right: 100,
      toJSON: () => undefined,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    }));
    const bufferedElement = document.createElement("diffs-container");
    bufferedElement.getBoundingClientRect = vi.fn(() => ({
      bottom: 160,
      height: 40,
      left: 0,
      right: 100,
      toJSON: () => undefined,
      top: 120,
      width: 100,
      x: 0,
      y: 120,
    }));
    vi.spyOn(PierreCodeView.prototype, "getContainerElement").mockReturnValue(
      container
    );
    vi.spyOn(PierreCodeView.prototype, "getRenderedItems").mockReturnValue([
      {
        element: visibleElement,
        id: "file.ts",
        instance: {} as never,
        item: {} as never,
        type: "diff",
        version: 0,
      },
      {
        element: bufferedElement,
        id: "second.ts",
        instance: {} as never,
        item: {} as never,
        type: "diff",
        version: 0,
      },
    ]);
    const onRenderWindowChange = vi.fn();
    render(
      <PierDiffView
        appearance={appearance}
        items={[
          ...items,
          {
            cacheKey: "revision:second.ts",
            id: "second.ts",
            patch:
              "diff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1 +1 @@\n-old\n+new\n",
          },
        ]}
        labels={labels}
        onError={vi.fn()}
        onRenderWindowChange={onRenderWindowChange}
      />
    );

    await waitFor(() =>
      expect(onRenderWindowChange).toHaveBeenCalledWith({
        bufferedItemIds: ["second.ts"],
        visibleItemIds: ["file.ts"],
      })
    );
  });

  it("以 module 模式启动官方 Worker，兼容 Vite 开发态 ESM 入口", async () => {
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );

    await waitFor(() => expect(workers).toHaveLength(poolSize));
    expect(workerConstructionOptions).toHaveLength(poolSize);
    expect(
      workerConstructionOptions.every((options) => options?.type === "module")
    ).toBe(true);
  });

  it("CodeView 与官方 worker 使用同一个项目代码主题", async () => {
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(workers).toHaveLength(poolSize);
      expect(
        workers
          .flatMap((worker) => worker.requests)
          .filter((request) => request.type === "initialize")
      ).not.toHaveLength(0);
    });
    expect(
      workers
        .flatMap((worker) => worker.requests)
        .filter((request) => request.type === "initialize")
        .map((request) => request.renderTheme)
    ).toEqual(expect.arrayContaining([appearance.codeTheme]));

    view.rerender(
      <PierDiffView
        appearance={{ ...appearance, codeTheme: "github-light" }}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(
        workers
          .flatMap((worker) => worker.requests)
          .filter((request) => request.type === "set-render-options")
          .map((request) => request.renderTheme)
      ).toEqual(expect.arrayContaining(["github-light"]));
    });
  });

  it("复用官方 header prefix 折叠并重新展开文件差异", async () => {
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );

    const collapse = await screen.findByRole("button", {
      name: labels.collapseDiff,
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(
      await screen.findByRole("button", { name: labels.expandDiff })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("正文更新、折叠、Worker fallback 与导航展开保持同一官方 item 版本链", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ref = createRef<PierDiffViewHandle>();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const scrollTo = vi.spyOn(PierreCodeView.prototype, "scrollTo");
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    act(() =>
      ref.current?.updateItems([
        {
          cacheKey: "document:file.ts",
          id: "file.ts",
          patch: items[0].patch.replace("+new", "+loaded"),
        },
      ])
    );
    const documentItem = updateItem.mock.calls.at(-1)?.[0];
    const documentVersion = documentItem?.version;
    const collapse = await screen.findByRole("button", {
      name: labels.collapseDiff,
    });
    fireEvent.click(collapse);
    const collapsedItem = updateItem.mock.calls.at(-1)?.[0];
    expect(collapsedItem).toBe(documentItem);
    expect(collapsedItem?.collapsed).toBe(true);
    expect(collapsedItem?.version).toBe(Number(documentVersion) + 1);

    const callsBeforeFallback = setItems.mock.calls.length;
    act(() => workers[0]?.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(setItems.mock.calls.length).toBeGreaterThan(callsBeforeFallback)
    );
    expect(setItems.mock.calls.at(-1)?.[0][0]).toBe(collapsedItem);

    act(() =>
      ref.current?.updateItems([
        {
          cacheKey: "document-2:file.ts",
          id: "file.ts",
          patch: items[0].patch.replace("+new", "+newer"),
        },
      ])
    );
    const refreshedItem = updateItem.mock.calls.at(-1)?.[0];
    expect(refreshedItem?.collapsed).toBe(true);
    expect(refreshedItem?.version).toBe(Number(collapsedItem?.version) + 1);
    const refreshedVersion = refreshedItem?.version;

    updateItem.mockClear();
    scrollTo.mockClear();
    act(() => {
      expect(ref.current?.scrollToItem("file.ts")).toBe(true);
    });
    const expandedItem = updateItem.mock.calls.at(-1)?.[0];
    expect(expandedItem?.collapsed).toBe(false);
    expect(expandedItem?.version).toBe(Number(refreshedVersion) + 1);
    if (!(expandedItem?.type === "diff" && refreshedItem?.type === "diff")) {
      throw new Error("expected official diff items");
    }
    expect(expandedItem?.fileDiff).toBe(refreshedItem?.fileDiff);
    expect(scrollTo).toHaveBeenLastCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      type: "item",
    });
  });

  it("状态文件通过官方元数据保留路径、旧路径和变更类型", async () => {
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const statePatch =
      "diff --git a/__pier_state__ b/__pier_state__\n--- a/__pier_state__\n+++ b/__pier_state__\n@@ -1 +1 @@\n Binary file\n";
    const stateItems = [
      "added",
      "conflicted",
      "deleted",
      "modified",
      "renamed",
    ].map((status, index) => ({
      cacheKey: `state:${status}`,
      fileDisplay: {
        path:
          status === "renamed"
            ? 'src/dir\\..\\quoted"\nfile.bin'
            : `src/state-${index}.bin`,
        ...(status === "renamed" ? { previousPath: "src/old\\name.bin" } : {}),
        status: status as NonNullable<
          PierDiffViewItem["fileDisplay"]
        >["status"],
      },
      id: `state:${status}`,
      patch: statePatch,
    }));

    render(
      <PierDiffView
        appearance={appearance}
        items={stateItems}
        labels={labels}
        onError={vi.fn()}
      />
    );

    await waitFor(() => {
      const renderedItems = setItems.mock.calls.at(-1)?.[0];
      expect(
        renderedItems?.map((item) => {
          if (item.type !== "diff") {
            throw new Error("expected an official Pierre diff item");
          }
          return {
            name: item.fileDiff.name,
            previousName: item.fileDiff.prevName ?? null,
            type: item.fileDiff.type,
          };
        })
      ).toEqual([
        {
          name: "src/state-0.bin",
          previousName: null,
          type: "new",
        },
        {
          name: "src/state-1.bin",
          previousName: null,
          type: "change",
        },
        {
          name: "src/state-2.bin",
          previousName: null,
          type: "deleted",
        },
        {
          name: "src/state-3.bin",
          previousName: null,
          type: "change",
        },
        {
          name: 'src/dir\\..\\quoted"\nfile.bin',
          previousName: "src/old\\name.bin",
          type: "rename-changed",
        },
      ]);
    });
  });

  it("原生 Worker error 会立即卸载池并以官方 inline CodeView 恢复", async () => {
    const onError = vi.fn();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={onError}
      />
    );
    await waitFor(() => expect(workers).toHaveLength(poolSize));
    const callsBeforeFailure = setItems.mock.calls.length;

    act(() => workers[0]?.dispatchEvent(new Event("error")));

    await waitFor(() => {
      expect(
        workers.every((worker) => worker.terminate.mock.calls.length > 0)
      ).toBe(true);
      expect(setItems.mock.calls.length).toBeGreaterThan(callsBeforeFailure);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("Worker 初始化永不结算时由有界看门狗切到官方 inline CodeView", async () => {
    vi.useFakeTimers();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    vi.stubGlobal(
      "Worker",
      class extends TestWorker {
        constructor(_url: URL, options?: WorkerOptions) {
          super();
          workers.push(this);
          workerConstructionOptions.push(options);
        }

        override postMessage(value: unknown): void {
          const request = readRequest(value);
          if (request) {
            this.requests.push(request);
          }
        }
      }
    );
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    expect(workers).toHaveLength(poolSize);
    const callsBeforeTimeout = setItems.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(
      workers.every((worker) => worker.terminate.mock.calls.length > 0)
    ).toBe(true);
    expect(setItems.mock.calls.length).toBeGreaterThan(callsBeforeTimeout);
  });

  it("inline 成功后后续文档代际未渲染仍由看门狗报告", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    interface FileDiffPostRender {
      emitPostRender(unmount?: boolean): void;
    }
    const prototype = PierreFileDiff.prototype as unknown as FileDiffPostRender;
    const originalEmit = prototype.emitPostRender;
    let suppressPostRender = false;
    vi.spyOn(prototype, "emitPostRender").mockImplementation(function (
      this: FileDiffPostRender,
      unmount
    ) {
      if (!suppressPostRender) {
        originalEmit.call(this, unmount);
      }
    });
    const onError = vi.fn();
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={onError}
      />
    );
    await waitFor(() => expect(workers).toHaveLength(poolSize));
    act(() => workers[0]?.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(
        workers.every((worker) => worker.terminate.mock.calls.length > 0)
      ).toBe(true)
    );

    suppressPostRender = true;
    vi.useFakeTimers();
    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[
          {
            ...items[0],
            cacheKey: "revision-2:file.ts",
            patch: items[0].patch.replace("+new", "+newer"),
          },
        ]}
        labels={labels}
        onError={onError}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pierre did not render the diff after the worker fallback.",
      })
    );
  });

  it("多个可见 item 只有一个完成时 inline 看门狗仍报告失败", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    interface FileDiffPostRender {
      emitPostRender(unmount?: boolean): void;
    }
    const prototype = PierreFileDiff.prototype as unknown as FileDiffPostRender;
    const originalEmit = prototype.emitPostRender;
    let allowedInstance: FileDiffPostRender | null = null;
    vi.spyOn(prototype, "emitPostRender").mockImplementation(function (
      this: FileDiffPostRender,
      unmount
    ) {
      if (unmount) {
        originalEmit.call(this, true);
        return;
      }
      allowedInstance ??= this;
      if (allowedInstance === this) {
        originalEmit.call(this, false);
      }
    });
    const onError = vi.fn();
    const secondItem = {
      cacheKey: "revision:second.ts",
      id: "second.ts",
      patch:
        "diff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1 +1 @@\n-old\n+new\n",
    };
    render(
      <PierDiffView
        appearance={appearance}
        items={[...items, secondItem]}
        labels={labels}
        onError={onError}
      />
    );
    await waitFor(() => expect(workers).toHaveLength(poolSize));

    allowedInstance = null;
    vi.useFakeTimers();
    act(() => workers[0]?.dispatchEvent(new Event("error")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pierre did not render the diff after the worker fallback.",
      })
    );
  });

  it("滚动后的官方下一帧出现未完成 item 时重新启动可见窗口监督", async () => {
    const firstElement = document.createElement("diffs-container");
    let visibleItems = [{ element: firstElement, id: "file.ts", version: 0 }];
    let watchdog: ReturnType<typeof useDiffRenderWatchdog> | undefined;
    function WatchdogHarness(): React.JSX.Element {
      watchdog = useDiffRenderWatchdog(
        "inline:theme",
        visibleItems,
        () => visibleItems
      );
      return (
        <output data-testid="watchdog-pending">
          {watchdog.pendingRenderKey ?? ""}
        </output>
      );
    }
    render(<WatchdogHarness />);
    act(() => watchdog?.markRendered("file.ts", 0, firstElement));
    await waitFor(() =>
      expect(screen.getByTestId("watchdog-pending")).toHaveTextContent("")
    );

    vi.useFakeTimers();
    act(() => {
      watchdog?.auditVisibleItems();
      requestAnimationFrame(() => {
        visibleItems = [
          {
            element: document.createElement("diffs-container"),
            id: "next.ts",
            version: 0,
          },
        ];
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByTestId("watchdog-pending").textContent).not.toBe("");
  });

  it("删除后重加同 id 与 version 必须等待新渲染元素确认", async () => {
    const firstElement = document.createElement("diffs-container");
    const secondElement = document.createElement("diffs-container");
    let watchdog: ReturnType<typeof useDiffRenderWatchdog> | undefined;
    function WatchdogHarness({
      renderedItems,
    }: {
      readonly renderedItems: readonly {
        readonly element: Element;
        readonly id: string;
        readonly version: number;
      }[];
    }): React.JSX.Element {
      watchdog = useDiffRenderWatchdog(
        "inline:theme",
        renderedItems,
        () => renderedItems
      );
      return (
        <output data-testid="watchdog-readded-pending">
          {watchdog.pendingRenderKey ?? ""}
        </output>
      );
    }
    const original = [{ element: firstElement, id: "file.ts", version: 0 }];
    const view = render(<WatchdogHarness renderedItems={original} />);
    act(() => watchdog?.markRendered("file.ts", 0, firstElement));
    await waitFor(() =>
      expect(screen.getByTestId("watchdog-readded-pending")).toHaveTextContent(
        ""
      )
    );

    view.rerender(<WatchdogHarness renderedItems={[]} />);
    const readded = [{ element: secondElement, id: "file.ts", version: 0 }];
    view.rerender(<WatchdogHarness renderedItems={readded} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("watchdog-readded-pending").textContent
      ).not.toBe("")
    );

    act(() => watchdog?.markRendered("file.ts", 0, secondElement));
    await waitFor(() =>
      expect(screen.getByTestId("watchdog-readded-pending")).toHaveTextContent(
        ""
      )
    );
  });

  it("多个 Review 共享官方 Worker 池，故障同退化且最后实例释放后可重建", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const secondItems = items.map((item) => ({
      ...item,
      cacheKey: `second:${item.cacheKey}`,
      id: `second:${item.id}`,
    }));
    const view = render(
      <>
        <PierDiffView
          appearance={appearance}
          items={items}
          key="first"
          labels={labels}
          onError={vi.fn()}
        />
        <PierDiffView
          appearance={appearance}
          items={secondItems}
          key="second"
          labels={labels}
          onError={vi.fn()}
        />
      </>
    );
    await waitFor(() => expect(workers).toHaveLength(poolSize));

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={secondItems}
        key="second"
        labels={labels}
        onError={vi.fn()}
      />
    );
    expect(workers.every((worker) => !worker.terminate.mock.calls.length)).toBe(
      true
    );

    view.rerender(
      <>
        <PierDiffView
          appearance={appearance}
          items={items}
          key="first"
          labels={labels}
          onError={vi.fn()}
        />
        <PierDiffView
          appearance={appearance}
          items={secondItems}
          key="second"
          labels={labels}
          onError={vi.fn()}
        />
      </>
    );
    const callsBeforeFailure = setItems.mock.calls.length;
    act(() => workers[0]?.dispatchEvent(new Event("error")));
    await waitFor(() => {
      expect(
        workers.every((worker) => worker.terminate.mock.calls.length > 0)
      ).toBe(true);
      expect(setItems.mock.calls.length).toBeGreaterThanOrEqual(
        callsBeforeFailure + 2
      );
    });

    view.unmount();
    const reopened = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() => expect(workers).toHaveLength(poolSize * 2));
    expect(
      workers
        .slice(poolSize)
        .every((worker) => !worker.terminate.mock.calls.length)
    ).toBe(true);
    reopened.unmount();
    expect(
      workers
        .slice(poolSize)
        .every((worker) => worker.terminate.mock.calls.length)
    ).toBe(true);
  });

  it("只通过官方 CodeView handle 定位已存在的 item", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const scrollTo = vi.spyOn(PierreCodeView.prototype, "scrollTo");
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    act(() => {
      expect(ref.current?.scrollToItem("missing.ts")).toBe(false);
      expect(ref.current?.scrollToItem("file.ts")).toBe(true);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      type: "item",
    });
  });

  it("可见性必须同时匹配当前 cacheKey 与官方受控 version", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const container = document.createElement("div");
    const renderedElement = document.createElement("diffs-container");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      top: 0,
    } as DOMRect);
    vi.spyOn(renderedElement, "getBoundingClientRect").mockReturnValue({
      bottom: 40,
      top: 10,
    } as DOMRect);
    let renderedVersion = 0;
    vi.spyOn(PierreCodeView.prototype, "getContainerElement").mockReturnValue(
      container
    );
    vi.spyOn(PierreCodeView.prototype, "getRenderedItems").mockImplementation(
      () => [
        {
          element: renderedElement,
          id: "file.ts",
          instance: {} as never,
          item: {} as never,
          type: "diff",
          version: renderedVersion,
        },
      ]
    );
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(ref.current?.isItemVisible("file.ts", "revision:file.ts")).toBe(
      true
    );
    expect(ref.current?.isItemVisible("file.ts", "stale-revision")).toBe(false);

    renderedVersion = 1;
    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[{ ...items[0], cacheKey: "revision-2:file.ts" }]}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await waitFor(() =>
      expect(ref.current?.isItemVisible("file.ts", "revision-2:file.ts")).toBe(
        true
      )
    );
    expect(ref.current?.isItemVisible("file.ts", "revision:file.ts")).toBe(
      false
    );
  });

  it("同一 item 内容变化时通过官方 updateItem 递增 version", async () => {
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() => expect(setItems).toHaveBeenCalled());
    const initialVersion = setItems.mock.calls.at(-1)?.[0][0]?.version;

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[{ ...items[0], cacheKey: "revision-2:file.ts" }]}
        labels={labels}
        onError={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(updateItem.mock.calls.at(-1)?.[0].version).toBe(
        Number(initialVersion) + 1
      );
    });
  });

  it("同拓扑正文首次被 Pierre 拒绝时下一帧自动重试，接受前不推进缓存", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const onError = vi.fn();
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={onError}
        ref={ref}
      />
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    const updatedItems = [{ ...items[0], cacheKey: "revision-retry:file.ts" }];
    updateItem.mockClear();
    updateItem.mockReturnValueOnce(false);
    vi.useFakeTimers();

    act(() => {
      view.rerender(
        <PierDiffView
          appearance={appearance}
          items={updatedItems}
          labels={labels}
          onError={onError}
          ref={ref}
        />
      );
    });
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(ref.current?.updateItems(items)).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(updateItem.mock.calls[1]?.[0]).toBe(updateItem.mock.calls[0]?.[0]);
    act(() => {
      expect(ref.current?.updateItems(updatedItems)).toBe(true);
    });
    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("单项解析失败保留完整拓扑，并且不触发全局运行时错误", async () => {
    const onError = vi.fn();
    const onItemError = vi.fn();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    render(
      <PierDiffView
        appearance={appearance}
        items={[
          items[0],
          {
            cacheKey: "broken:other.ts",
            fileDisplay: { path: "other.ts", status: "modified" },
            id: "other.ts",
            patch: "diff --git",
          },
        ]}
        labels={labels}
        onError={onError}
        onItemError={onItemError}
      />
    );

    await waitFor(() =>
      expect(onItemError).toHaveBeenCalledWith("other.ts", expect.any(Error))
    );
    expect(setItems.mock.calls.at(-1)?.[0].map((item) => item.id)).toEqual([
      "file.ts",
      "other.ts",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("增量解析错误在条目离开拓扑时清除", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const onItemError = vi.fn();
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        onItemError={onItemError}
        ref={ref}
      />
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    updateItem.mockClear();

    act(() =>
      ref.current?.updateItems([
        {
          ...items[0],
          cacheKey: "broken:file.ts",
          patch: "diff --git",
        },
      ])
    );
    await waitFor(() =>
      expect(onItemError).toHaveBeenCalledWith("file.ts", expect.any(Error))
    );
    expect(updateItem).not.toHaveBeenCalled();

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[]}
        labels={labels}
        onError={vi.fn()}
        onItemError={onItemError}
        ref={ref}
      />
    );
    await waitFor(() =>
      expect(onItemError).toHaveBeenLastCalledWith("file.ts", null)
    );
  });

  it("2,001 项拓扑中的单项正文只通过一次增量 updateItem 提交", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const placeholders: PierDiffViewItem[] = Array.from(
      { length: 2001 },
      (_, index) => ({
        cacheKey: `placeholder:${index}`,
        fileDisplay: { path: `file-${index}.ts`, status: "modified" },
        id: `file-${index}.ts`,
        patch: null,
      })
    );
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={placeholders}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await waitFor(() =>
      expect(setItems.mock.calls.at(-1)?.[0]).toHaveLength(2001)
    );
    const initialSetCalls = setItems.mock.calls.length;

    act(() =>
      ref.current?.updateItems([
        {
          cacheKey: "document:2000",
          fileDisplay: { path: "file-2000.ts", status: "modified" },
          id: "file-2000.ts",
          patch:
            "diff --git a/file-2000.ts b/file-2000.ts\n--- a/file-2000.ts\n+++ b/file-2000.ts\n@@ -1 +1 @@\n-old\n+new\n",
        },
      ])
    );

    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem.mock.calls[0]?.[0].id).toBe("file-2000.ts");
    expect(setItems).toHaveBeenCalledTimes(initialSetCalls);

    const acceptedItem = updateItem.mock.calls[0]?.[0];
    act(() => workers[0]?.dispatchEvent(new Event("error")));
    await waitFor(() =>
      expect(setItems.mock.calls.length).toBeGreaterThan(initialSetCalls)
    );
    expect(setItems.mock.calls.at(-1)?.[0][2000]).toBe(acceptedItem);

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[
          {
            cacheKey: "next-generation:new.ts",
            fileDisplay: { path: "new.ts", status: "added" },
            id: "new.ts",
            patch:
              "diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new\n",
          },
        ]}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await waitFor(() =>
      expect(setItems.mock.calls.at(-1)?.[0].map((item) => item.id)).toEqual([
        "new.ts",
      ])
    );
  });

  it("2,001 项中折叠单项只调用一次 updateItem，不重建拓扑或替换其他 item", async () => {
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const largeItems: PierDiffViewItem[] = [
      items[0],
      ...Array.from({ length: 2000 }, (_, index) => ({
        cacheKey: `placeholder:${index}`,
        fileDisplay: {
          path: `placeholder-${index}.ts`,
          status: "modified" as const,
        },
        id: `placeholder-${index}.ts`,
        patch: null,
      })),
    ];
    render(
      <PierDiffView
        appearance={appearance}
        items={largeItems}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(setItems.mock.calls.at(-1)?.[0]).toHaveLength(2001)
    );
    const initialItems = setItems.mock.calls.at(-1)?.[0];
    const untouchedItem = initialItems?.[1];
    const initialSetCalls = setItems.mock.calls.length;
    updateItem.mockClear();

    fireEvent.click(
      await screen.findByRole("button", { name: labels.collapseDiff })
    );

    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem.mock.calls[0]?.[0]).toBe(initialItems?.[0]);
    expect(initialItems?.[1]).toBe(untouchedItem);
    expect(setItems).toHaveBeenCalledTimes(initialSetCalls);
  });

  it("增量正文改变条目高度时通过官方滚动接口保留顶部锚点", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const renderedElement = document.createElement("diffs-container");
    vi.spyOn(PierreCodeView.prototype, "getRenderedItems").mockReturnValue([
      {
        element: renderedElement,
        id: "file.ts",
        instance: {} as never,
        item: {} as never,
        type: "diff",
        version: 0,
      },
    ]);
    vi.spyOn(
      PierreCodeView.prototype,
      "getLocalTopForInstance"
    ).mockReturnValue(80);
    vi.spyOn(PierreCodeView.prototype, "getContainerElement").mockReturnValue(
      Object.assign(document.createElement("div"), { scrollTop: 92 })
    );
    const scrollTo = vi.spyOn(PierreCodeView.prototype, "scrollTo");
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    act(() =>
      ref.current?.updateItems([
        {
          cacheKey: "revision:file.ts:2",
          id: "file.ts",
          patch:
            "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n",
        },
      ])
    );

    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      offset: -12,
      type: "item",
    });

    scrollTo.mockClear();
    act(() =>
      ref.current?.updateItems(
        [
          {
            cacheKey: "revision:file.ts:3",
            id: "file.ts",
            patch:
              "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,3 @@\n-old\n+new\n+line\n+more\n",
          },
        ],
        { preserveAnchor: false }
      )
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("放弃的删除渲染不会让同 id 新正文复用旧 version", async () => {
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const never = new Promise<void>(() => undefined);
    let update: (state: {
      blocked: boolean;
      inputs: readonly PierDiffViewItem[];
    }) => void = () => undefined;
    function Block({ active }: { readonly active: boolean }): null {
      if (active) {
        throw never;
      }
      return null;
    }
    function Harness(): React.JSX.Element {
      const [state, setState] = useState({
        blocked: false,
        inputs: items as readonly PierDiffViewItem[],
      });
      update = setState;
      return (
        <>
          <PierDiffView
            appearance={appearance}
            items={state.inputs}
            labels={labels}
            onError={vi.fn()}
          />
          <Block active={state.blocked} />
        </>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(setItems).toHaveBeenCalled());
    const initialVersion = setItems.mock.calls.at(-1)?.[0][0]?.version;

    act(() => {
      startTransition(() => update({ blocked: true, inputs: [] }));
    });
    act(() => {
      flushSync(() =>
        update({
          blocked: false,
          inputs: [
            {
              ...items[0],
              cacheKey: "revision-after-abandoned-delete:file.ts",
            },
          ],
        })
      );
    });

    await waitFor(() => {
      expect(updateItem.mock.calls.at(-1)?.[0].version).toBe(
        Number(initialVersion) + 1
      );
    });
  });

  it("拓扑变化时以当前权威快照重建，并清理已删除项缓存", async () => {
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const setOptions = vi.spyOn(PierreCodeView.prototype, "setOptions");
    const secondItem = {
      cacheKey: "revision:second.ts",
      id: "second.ts",
      patch:
        "diff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1 +1 @@\n-old\n+new\n",
    };
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() => expect(setItems).toHaveBeenCalled());
    const firstControlledItem = setItems.mock.calls.at(-1)?.[0][0];
    const optionUpdatesBeforeAppend = setOptions.mock.calls.length;

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[...items, secondItem]}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(setItems.mock.calls.at(-1)?.[0]).toHaveLength(2)
    );
    expect(setItems.mock.calls.at(-1)?.[0][1]).toEqual(
      expect.objectContaining({ id: "second.ts" })
    );
    expect(setItems.mock.calls.at(-1)?.[0][0]).toBe(firstControlledItem);
    expect(setOptions.mock.calls.length).toBeGreaterThanOrEqual(
      optionUpdatesBeforeAppend
    );

    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[]}
        labels={labels}
        onError={vi.fn()}
      />
    );
    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(setItems.mock.calls.at(-1)?.[0][0]?.id).toBe("file.ts")
    );
    expect(setItems.mock.calls.at(-1)?.[0][0]?.version).toBe(0);
  });

  it("通过官方实例捕获并恢复顶部 item 锚点", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const getRenderedItems = vi
      .spyOn(PierreCodeView.prototype, "getRenderedItems")
      .mockReturnValue([
        {
          element: document.createElement("diffs-container"),
          id: "file.ts",
          instance: {} as never,
          item: {} as never,
          type: "diff",
          version: 0,
        },
      ]);
    vi.spyOn(
      PierreCodeView.prototype,
      "getLocalTopForInstance"
    ).mockReturnValue(120);
    vi.spyOn(PierreCodeView.prototype, "getContainerElement").mockReturnValue(
      Object.assign(document.createElement("div"), { scrollTop: 150 })
    );
    const scrollTo = vi.spyOn(PierreCodeView.prototype, "scrollTo");
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(ref.current?.captureTopAnchor()).toEqual({
      id: "file.ts",
      offset: -30,
    });
    expect(ref.current?.restoreAnchor({ id: "file.ts", offset: -30 })).toBe(
      true
    );
    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      offset: -30,
      type: "item",
    });
    expect(getRenderedItems).toHaveBeenCalled();
  });

  it("官方迟到滚动不冒充用户输入，只有明确交互意图取消锚点", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const onScroll = vi.fn();
    let emitOfficialScroll = (): void => undefined;
    vi.spyOn(PierreCodeView.prototype, "scrollTo").mockImplementation(
      () => undefined
    );
    vi.spyOn(PierreCodeView.prototype, "subscribeToScroll").mockImplementation(
      (listener) => {
        emitOfficialScroll = () => listener(0, undefined as never);
        return () => undefined;
      }
    );
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        onScroll={onScroll}
        ref={ref}
      />
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(ref.current?.restoreAnchor({ id: "file.ts", offset: -8 })).toBe(
      true
    );

    act(() => emitOfficialScroll());
    expect(onScroll).not.toHaveBeenCalled();
    fireEvent.wheel(view.getByTestId("pierre-diff-root"));
    expect(onScroll).toHaveBeenCalledOnce();
    act(() => emitOfficialScroll());
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("官方主题同步失败时把错误交给宿主反馈", async () => {
    const onError = vi.fn();
    vi.spyOn(WorkerPoolManager.prototype, "setRenderOptions").mockRejectedValue(
      new Error("theme sync failed")
    );
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={onError}
      />
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "theme sync failed" })
      );
    });
  });
});
