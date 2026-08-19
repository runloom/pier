import "@testing-library/jest-dom/vitest";

// Husky pre-push sets GIT_DIR to the host repo. Git tests that spawn `git`
// in a temp work tree then inherit it and fail with "must be run in a work tree".
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
] as const) {
  Reflect.deleteProperty(process.env, key);
}

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

// Mermaid 的官方渲染器会读取 SVG 文本几何。jsdom 不实现 getBBox，
// 组件测试只验证图型覆盖与安全输出，不依赖真实排版像素。
if (
  typeof globalThis.SVGElement !== "undefined" &&
  !("getBBox" in SVGElement.prototype)
) {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    value: () => new DOMRect(0, 0, 120, 24),
  });
}

if (
  typeof globalThis.SVGElement !== "undefined" &&
  !("getComputedTextLength" in SVGElement.prototype)
) {
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    value: () => 120,
  });
}

// Mermaid mindmap 走 cytoscape，需要 Canvas 2d。jsdom 的 getContext
// 会抛 Not implemented；给一个 no-op 上下文即可完成布局，图仍画成 SVG。
if (typeof globalThis.HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    type: string
  ) {
    if (type !== "2d") {
      return null;
    }
    const target: Record<PropertyKey, unknown> = { canvas: this };
    return new Proxy(target, {
      get(current, prop) {
        if (prop in current) {
          return current[prop];
        }
        if (prop === "measureText") {
          return (text: string) => ({
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 4,
            fontBoundingBoxAscent: 12,
            fontBoundingBoxDescent: 4,
            width: String(text).length * 8,
          });
        }
        if (prop === "getImageData") {
          return (_x: number, _y: number, width: number, height: number) => ({
            data: new Uint8ClampedArray(
              Math.max(1, width) * Math.max(1, height) * 4
            ),
            height,
            width,
          });
        }
        if (
          prop === "createLinearGradient" ||
          prop === "createRadialGradient" ||
          prop === "createConicGradient"
        ) {
          return () => ({ addColorStop() {} });
        }
        if (prop === "createPattern") {
          return () => null;
        }
        return () => undefined;
      },
      set(current, prop, value) {
        current[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
}
