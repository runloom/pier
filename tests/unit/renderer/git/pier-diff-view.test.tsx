import {
  PierDiffView,
  type PierDiffViewHandle,
  type PierDiffViewItem,
} from "@pier/ui/diff-view/index.tsx";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, type RefObject, startTransition, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodeView as PierreCodeView,
  FileDiff as PierreFileDiff,
} from "../../../../packages/ui/node_modules/@pierre/diffs/dist/index.js";
import { WorkerPoolManager } from "../../../../packages/ui/node_modules/@pierre/diffs/dist/worker/index.js";
import { useDiffRenderWatchdog } from "../../../../packages/ui/src/diff-view/render-watchdog.ts";

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
  codeFontFamily: "monospace",
  codeFontSize: "13px",
  codeThemes: {
    dark: "github-dark",
    light: "github-light",
  },
  colorMode: "dark",
} as const;

const labels = {
  collapseDiff: "Collapse diff",
  discardChanges: "Restore",
  expandDiff: "Expand diff",
  stageChanges: "Stage",
  unstageChanges: "Unstage",
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
    bufferedElement.setAttribute("data-pier-estimate", "true");
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
        estimatedItemIds: ["second.ts"],
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
    ).toEqual(
      expect.arrayContaining([
        {
          dark: appearance.codeThemes.dark,
          light: appearance.codeThemes.light,
        },
      ])
    );

    view.rerender(
      <PierDiffView
        appearance={{
          ...appearance,
          codeThemes: {
            dark: "one-dark-pro",
            light: "one-light",
          },
        }}
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
      ).toEqual(
        expect.arrayContaining([
          {
            dark: "one-dark-pro",
            light: "one-light",
          },
        ])
      );
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

  describe("折叠全部", () => {
    const pendingItem: PierDiffViewItem = {
      cacheKey: "estimate:pending.ts",
      fileDisplay: { path: "pending.ts", status: "modified" },
      id: "pending.ts",
      patch: null,
    };
    const hydratedPatch =
      "diff --git a/pending.ts b/pending.ts\n--- a/pending.ts\n+++ b/pending.ts\n@@ -1 +1 @@\n-old\n+hydrated\n";

    async function renderWithPending(
      ref: RefObject<PierDiffViewHandle | null>
    ) {
      render(
        <PierDiffView
          appearance={appearance}
          items={[items[0], pendingItem]}
          labels={labels}
          onError={vi.fn()}
          ref={ref}
        />
      );
      await waitFor(() => expect(ref.current).not.toBeNull());
    }

    it("骨架槽点击时已是折叠态，水合后的正文仍继承折叠", async () => {
      // 回归：estimate 默认 collapsed，逐项翻转会因「已是目标态」提前返回而不留
      // 记录，正文到达时回落解析默认（有正文即展开）→ 表现为折叠全部漏折叠。
      const ref = createRef<PierDiffViewHandle>();
      const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
      await renderWithPending(ref);

      act(() => ref.current?.setAllCollapsed(true));
      updateItem.mockClear();

      act(() =>
        ref.current?.updateItems([
          {
            cacheKey: "document:pending.ts",
            fileDisplay: { path: "pending.ts", status: "modified" },
            id: "pending.ts",
            patch: hydratedPatch,
          },
        ])
      );

      const hydrated = updateItem.mock.calls.at(-1)?.[0];
      expect(hydrated?.id).toBe("pending.ts");
      expect(hydrated?.collapsed).toBe(true);
    });

    it("折叠后才进入投影窗口的文件继承折叠缺省", async () => {
      const ref = createRef<PierDiffViewHandle>();
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

      act(() => ref.current?.setAllCollapsed(true));

      view.rerender(
        <PierDiffView
          appearance={appearance}
          items={[
            items[0],
            {
              cacheKey: "document:arrived.ts",
              fileDisplay: { path: "arrived.ts", status: "added" },
              id: "arrived.ts",
              patch:
                "diff --git a/arrived.ts b/arrived.ts\n--- /dev/null\n+++ b/arrived.ts\n@@ -0,0 +1 @@\n+arrived\n",
            },
          ]}
          labels={labels}
          onError={vi.fn()}
          ref={ref}
        />
      );

      // 两个文件都应折叠：先在场的那个被逐项翻转，后到的靠缺省层继承。
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: labels.expandDiff })
        ).toHaveLength(2)
      );
      expect(
        screen.queryByRole("button", { name: labels.collapseDiff })
      ).toBeNull();
    });

    it("展开全部跳过 0 行正文槽，不把骨架撑成空壳", async () => {
      const ref = createRef<PierDiffViewHandle>();
      const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
      await renderWithPending(ref);

      act(() => ref.current?.setAllCollapsed(true));
      updateItem.mockClear();
      act(() => ref.current?.setAllCollapsed(false));

      const touched = updateItem.mock.calls.map((call) => call[0]?.id);
      expect(touched).toContain("file.ts");
      expect(touched).not.toContain("pending.ts");
    });
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
    // 折叠必须克隆而非就地改写共享缓存条目:就地 +1 会把折叠中的占位符
    // 顶到与稍后到达的正文相同的版本号,CodeView 按 version 去重时丢弃正文。
    expect(collapsedItem).not.toBe(documentItem);
    if (!(collapsedItem?.type === "diff" && documentItem?.type === "diff")) {
      throw new Error("expected official diff items");
    }
    expect(collapsedItem.fileDiff).toBe(documentItem.fileDiff);
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
      patch: null,
      stateNotice: "Binary file — content not shown",
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
    // 已在拓扑中的成员用 smooth；新建/刚展开用 instant
    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "smooth",
      id: "file.ts",
      type: "item",
    });
  });

  it("instant 定位在 microtask 内完成两阶段虚拟窗口布局", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const renderNow = vi.spyOn(PierreCodeView.prototype, "render");
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

    // 已在场且不展开的目标几何不变：预测量是白刷，只会平白扰动布局。
    renderNow.mockClear();
    act(() => {
      expect(
        ref.current?.scrollToItem("file.ts", { behavior: "instant" })
      ).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderNow).not.toHaveBeenCalledWith(true);

    // 折叠目标被展开 → 几何要变，必须预测量；但树导航从 useLayoutEffect 进来，
    // 同步 render(true) 会在 React 渲染期触发 Pierre 的 flushSync，只告警并降级。
    // 两阶段布局只能留到 microtask，仍在 paint 前。
    act(() => {
      ref.current?.setAllCollapsed(true);
    });
    renderNow.mockClear();
    act(() => {
      expect(
        ref.current?.scrollToItem("file.ts", { behavior: "instant" })
      ).toBe(true);
    });
    expect(renderNow).not.toHaveBeenCalledWith(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      renderNow.mock.calls.filter(([immediate]) => immediate === true)
    ).toHaveLength(2);
  });

  it("被动恢复不得展开折叠目标（expandCollapsed:false）", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
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
      ref.current?.setAllCollapsed(true);
    });
    updateItem.mockClear();
    act(() => {
      expect(
        ref.current?.scrollToItem("file.ts", {
          behavior: "instant",
          expandCollapsed: false,
        })
      ).toBe(true);
    });
    // 没有折叠翻转写入：恢复只把布局对回选中项，
    // 不改变用户刚表达的折叠意图，也就不制造大幅布局变动。
    expect(updateItem).not.toHaveBeenCalled();
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

  it("同拓扑正文被 Pierre 拒绝时在同一事务对账且不启动定时重试", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
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
    const setCallsBeforeReconcile = setItems.mock.calls.length;
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
    expect(setItems.mock.calls.length).toBe(setCallsBeforeReconcile + 1);
    await act(() => vi.runAllTimersAsync());
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("稀疏 updateItems 遇到未知拓扑 id 时整批拒绝，不提交部分正文", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    const onError = vi.fn();
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={onError}
        ref={ref}
      />
    );
    await waitFor(() => expect(ref.current).not.toBeNull());
    updateItem.mockClear();

    let accepted: boolean | undefined;
    expect(() => {
      act(() => {
        accepted = ref.current?.updateItems([
          {
            cacheKey: "document:file.ts",
            id: "file.ts",
            patch: items[0].patch.replace("+new", "+known"),
          },
          {
            cacheKey: "document:missing.ts",
            id: "sha256:89975872776f66d3cab99439a8d0be7970987bdfb858f46fe7b36bb9a44fdf64",
            patch:
              "diff --git a/missing.ts b/missing.ts\n--- a/missing.ts\n+++ b/missing.ts\n@@ -1 +1 @@\n-old\n+new\n",
          },
        ]);
      });
    }).not.toThrow();

    expect(accepted).toBe(false);
    expect(updateItem).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("稀疏 updateItems 被 Pierre 拒绝时在同一事务回退全量快照", async () => {
    const ref = createRef<PierDiffViewHandle>();
    const setItems = vi.spyOn(PierreCodeView.prototype, "setItems");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
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
    const setCallsBeforeUpdate = setItems.mock.calls.length;
    updateItem.mockClear();
    updateItem.mockReturnValueOnce(false);

    let accepted: boolean | undefined;
    act(() => {
      accepted = ref.current?.updateItems([
        {
          cacheKey: "revision:file.ts:atomic",
          id: "file.ts",
          patch: items[0].patch.replace("+new", "+atomic"),
        },
      ]);
    });

    expect(accepted).toBe(true);
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(setItems.mock.calls.length).toBe(setCallsBeforeUpdate + 1);
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

    // estimate 槽也有 header：取第一个 collapse（首项真 diff）
    const collapseButtons = await screen.findAllByRole("button", {
      name: labels.collapseDiff,
    });
    fireEvent.click(collapseButtons[0] as HTMLElement);

    expect(updateItem).toHaveBeenCalledTimes(1);
    // 折叠克隆新对象，禁止就地改写 initialItems[0]（version 链安全）。
    expect(updateItem.mock.calls[0]?.[0]).not.toBe(initialItems?.[0]);
    expect(updateItem.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        collapsed: true,
        id: initialItems?.[0]?.id,
      })
    );
    expect(initialItems?.[1]).toBe(untouchedItem);
    expect(setItems).toHaveBeenCalledTimes(initialSetCalls);
  });

  it("增量正文默认交给 Pierre 行级 anchoring，显式 preserveAnchor 才 item 级 restore", async () => {
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
    const renderNow = vi.spyOn(PierreCodeView.prototype, "render");
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
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
    // 默认 preserveAnchor:false → 不抢 Pierre 内置行锚
    expect(updateItem).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();

    scrollTo.mockClear();
    renderNow.mockClear();
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
        { preserveAnchor: true }
      )
    );
    expect(scrollTo).toHaveBeenCalledWith({
      align: "start",
      behavior: "instant",
      id: "file.ts",
      offset: -12,
      type: "item",
    });
    // membership layout flush 经 queueMicrotask（避 layout flushSync）
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderNow).toHaveBeenCalledWith(true);
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

    const addItems = vi.spyOn(PierreCodeView.prototype, "addItems");
    const addCallsBefore = addItems.mock.calls.length;
    view.rerender(
      <PierDiffView
        appearance={appearance}
        items={[...items, secondItem]}
        labels={labels}
        onError={vi.fn()}
      />
    );
    // DiffsHub 路径：前缀不变时 append addItems，不整表 setItems remount。
    await waitFor(() =>
      expect(addItems.mock.calls.length).toBeGreaterThan(addCallsBefore)
    );
    expect(addItems.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: "second.ts" }),
    ]);
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

  it("布局稳定适配器跟踪目标位置、连续稳定帧并支持取消", async () => {
    vi.useFakeTimers();
    const ref = createRef<PierDiffViewHandle>();
    const container = document.createElement("div");
    let targetTop = 100;
    Object.defineProperties(container, {
      checkVisibility: { value: () => true },
      clientHeight: { value: 600 },
      clientWidth: { value: 900 },
      scrollHeight: { value: 1200 },
    });
    document.body.append(container);
    const instance = {} as never;
    vi.spyOn(PierreCodeView.prototype, "getContainerElement").mockReturnValue(
      container
    );
    vi.spyOn(PierreCodeView.prototype, "getRenderedItems").mockReturnValue([
      {
        element: document.createElement("diffs-container"),
        id: "file.ts",
        instance,
        item: {} as never,
        type: "diff",
        version: 0,
      },
    ]);
    vi.spyOn(
      PierreCodeView.prototype,
      "getLocalTopForInstance"
    ).mockImplementation(() => targetTop);
    render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        ref={ref}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ref.current).not.toBeNull();
    expect(ref.current?.isViewportReady()).toBe(true);

    const firstKey = ref.current?.getViewportLayoutKey("file.ts");
    targetTop = 140;
    expect(ref.current?.getViewportLayoutKey("file.ts")).not.toBe(firstKey);

    const settled = vi.fn();
    ref.current?.requestViewportLayoutSettled("file.ts", 3, settled);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    targetTop = 180;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(settled).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(settled).toHaveBeenCalledOnce();

    const cancelled = vi.fn();
    const cancel = ref.current?.requestViewportLayoutSettled(
      "file.ts",
      2,
      cancelled
    );
    cancel?.();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(cancelled).not.toHaveBeenCalled();
    container.remove();
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
    const root = view.getByTestId("pierre-diff-root");
    const scroller = root.querySelector<HTMLElement>(".cv-scrollbar");
    expect(scroller).not.toBeNull();
    const action = document.createElement("button");
    root.append(action);
    fireEvent.pointerDown(scroller as HTMLElement, { button: 0 });
    expect(onScroll).toHaveBeenCalledOnce();
    fireEvent.pointerDown(action);
    fireEvent.keyDown(action, { key: " " });
    expect(onScroll).toHaveBeenCalledOnce();
    fireEvent.wheel(root);
    expect(onScroll).toHaveBeenCalledOnce();
    act(() => emitOfficialScroll());
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("视口滚动键会接管导航，交互控件按键不会", () => {
    const onScroll = vi.fn();
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        onScroll={onScroll}
      />
    );
    const root = view.getByTestId("pierre-diff-root");
    const scroller = root.querySelector<HTMLElement>(".cv-scrollbar");
    expect(scroller).not.toBeNull();
    const action = document.createElement("button");
    root.append(action);

    fireEvent.keyDown(action, { key: "PageDown" });
    expect(onScroll).not.toHaveBeenCalled();
    fireEvent.keyDown(scroller as HTMLElement, { key: "PageDown" });
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("正文左键拖选会接管导航，右键不会", async () => {
    const onScroll = vi.fn();
    const renderedElement = document.createElement("diffs-container");
    const line = document.createElement("span");
    line.setAttribute("data-additions", "");
    line.setAttribute("data-code", "");
    line.setAttribute("data-line", "1");
    renderedElement.append(line);
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
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        onScroll={onScroll}
      />
    );
    const root = view.getByTestId("pierre-diff-root");
    root.append(renderedElement);

    fireEvent.pointerDown(line, { button: 2 });
    expect(onScroll).not.toHaveBeenCalled();
    fireEvent.pointerDown(line, { button: 0 });
    expect(onScroll).toHaveBeenCalledOnce();
  });

  it("触摸轻点控件不接管导航，实际触摸滚动才接管", async () => {
    vi.useFakeTimers();
    const onScroll = vi.fn();
    const view = render(
      <PierDiffView
        appearance={appearance}
        items={items}
        labels={labels}
        onError={vi.fn()}
        onScroll={onScroll}
      />
    );
    const root = view.getByTestId("pierre-diff-root");
    const action = document.createElement("button");
    root.append(action);

    fireEvent.touchStart(action);
    expect(onScroll).not.toHaveBeenCalled();
    fireEvent.touchMove(action);
    expect(onScroll).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(161);
    fireEvent.touchMove(root);
    expect(onScroll).toHaveBeenCalledTimes(2);
  });

  it("header 空白点击折叠，文件名点击打开文件", async () => {
    const onOpenFile = vi.fn();
    const updateItem = vi.spyOn(PierreCodeView.prototype, "updateItem");
    render(
      <PierDiffView
        appearance={appearance}
        items={[
          {
            cacheKey: "revision:file.ts",
            fileDisplay: {
              path: "src/file.ts",
              status: "modified",
            },
            id: "file.ts",
            patch: items[0].patch,
          },
        ]}
        labels={labels}
        onError={vi.fn()}
        onOpenFile={onOpenFile}
      />
    );

    // Wait until official item is applied so getItem/updateItem are live.
    await screen.findByRole("button", { name: labels.collapseDiff });
    const root = screen.getByTestId("pierre-diff-root");

    const host = document.createElement("diffs-container");
    const header = document.createElement("div");
    header.setAttribute("data-diffs-header", "default");
    const title = document.createElement("div");
    title.setAttribute("data-title", "");
    header.append(title);

    vi.spyOn(PierreCodeView.prototype, "getRenderedItems").mockReturnValue([
      {
        element: host,
        id: "file.ts",
        instance: {} as never,
        item: { id: "file.ts", type: "diff" } as never,
        type: "diff",
        version: 1,
      },
    ]);
    vi.spyOn(PierreCodeView.prototype, "getItem").mockImplementation(
      (id: string) => {
        if (id !== "file.ts") {
          return;
        }
        return {
          collapsed: false,
          fileDiff: { splitLineCount: 2, unifiedLineCount: 2 },
          id: "file.ts",
          type: "diff",
        } as never;
      }
    );

    const before = updateItem.mock.calls.length;
    const headerClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.defineProperty(headerClick, "composedPath", {
      value: () => [header, host, root, document, window],
    });
    root.dispatchEvent(headerClick);
    await waitFor(() => {
      expect(updateItem.mock.calls.length).toBeGreaterThan(before);
    });
    expect(updateItem.mock.calls.at(-1)?.[0]).toMatchObject({
      collapsed: true,
      id: "file.ts",
    });
    expect(onOpenFile).not.toHaveBeenCalled();

    const titleClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.defineProperty(titleClick, "composedPath", {
      value: () => [title, header, host, root, document, window],
    });
    root.dispatchEvent(titleClick);
    expect(onOpenFile).toHaveBeenCalledWith("file.ts");

    // ⌘/Ctrl+click on the path title must still open (not a silent no-op).
    onOpenFile.mockClear();
    const titleMetaClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      metaKey: true,
    });
    Object.defineProperty(titleMetaClick, "composedPath", {
      value: () => [title, header, host, root, document, window],
    });
    root.dispatchEvent(titleMetaClick);
    expect(onOpenFile).toHaveBeenCalledWith("file.ts");
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
