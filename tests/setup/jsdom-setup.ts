import "@testing-library/jest-dom/vitest";

// jsdom 没有 ResizeObserver;react-resizable-panels(files 面板树列宽拖拽)
// 挂载期即 new ResizeObserver。提供最小 no-op polyfill,几何断言不依赖它。
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    disconnect(): void {
      // no-op
    }
    observe(): void {
      // no-op
    }
    unobserve(): void {
      // no-op
    }
  }
  globalThis.ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

function createEmptyDomRectList(): DOMRectList {
  const rects: DOMRect[] = [];
  return {
    [Symbol.iterator]: () => rects[Symbol.iterator](),
    item: () => null,
    length: 0,
  } as unknown as DOMRectList;
}

// CodeMirror 的选择层会调用 Range 几何 API;jsdom 缺这些实现时会在
// requestAnimationFrame 里抛未处理错误。组件测试不依赖真实像素位置,
// 返回空矩形即可保留编辑器命令和选择行为。
if (
  typeof globalThis.Range !== "undefined" &&
  typeof Range.prototype.getClientRects !== "function"
) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    value: createEmptyDomRectList,
  });
}

if (
  typeof globalThis.Range !== "undefined" &&
  typeof Range.prototype.getBoundingClientRect !== "function"
) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    value: () => new DOMRect(0, 0, 0, 0),
  });
}
