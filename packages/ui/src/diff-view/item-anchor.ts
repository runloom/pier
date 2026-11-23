import type { PierDiffViewAnchor } from "./handle-types.ts";

interface DiffViewItemAnchorSource<T> {
  getContainerElement(): HTMLElement | undefined;
  getLocalTopForInstance(instance: T): number;
  getRenderedItems(): readonly {
    readonly id: string;
    readonly instance: T;
  }[];
}

export function captureDiffViewItemAnchor<T>(
  viewer: DiffViewItemAnchorSource<T> | null | undefined,
  id: string
): PierDiffViewAnchor | null {
  const container = viewer?.getContainerElement();
  const item = viewer
    ?.getRenderedItems()
    .find((candidate) => candidate.id === id);
  if (!(viewer && container && item)) {
    return null;
  }
  return {
    id,
    offset: viewer.getLocalTopForInstance(item.instance) - container.scrollTop,
  };
}

export function captureDiffViewTopAnchor<T>(
  viewer: DiffViewItemAnchorSource<T> | null | undefined
): PierDiffViewAnchor | null {
  const container = viewer?.getContainerElement();
  const rendered = viewer?.getRenderedItems() ?? [];
  if (!(viewer && container && rendered.length > 0)) {
    return null;
  }
  const scrollTop = container.scrollTop;
  let candidate = rendered[0];
  for (const item of rendered) {
    const top = viewer.getLocalTopForInstance(item.instance);
    if (top > scrollTop) {
      break;
    }
    candidate = item;
  }
  return candidate
    ? {
        id: candidate.id,
        offset: viewer.getLocalTopForInstance(candidate.instance) - scrollTop,
      }
    : null;
}

interface DiffVirtualLayoutItem {
  readonly item?: { readonly id?: string };
  readonly top: number;
}

export interface DiffVirtualLayoutAnchor {
  readonly id: string;
  readonly viewportOffset: number;
}

function isObjectSource(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function readNumberMethod(source: object, key: string): number | undefined {
  const method: unknown = Reflect.get(source, key);
  if (typeof method !== "function") {
    return;
  }
  const value: unknown = Reflect.apply(method, source, []);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readPaddingTop(source: object): number {
  const getLayout: unknown = Reflect.get(source, "getLayout");
  if (typeof getLayout !== "function") {
    return 0;
  }
  const layout: unknown = Reflect.apply(getLayout, source, []);
  if (!(typeof layout === "object" && layout !== null)) {
    return 0;
  }
  const paddingTop: unknown = Reflect.get(layout, "paddingTop");
  return typeof paddingTop === "number" && Number.isFinite(paddingTop)
    ? paddingTop
    : 0;
}

function readItems(source: object): readonly DiffVirtualLayoutItem[] {
  const value: unknown = Reflect.get(source, "items");
  return Array.isArray(value)
    ? (value as readonly DiffVirtualLayoutItem[])
    : [];
}

function readItemId(item: DiffVirtualLayoutItem): string | undefined {
  const value: unknown = Reflect.get(item, "item");
  if (!(typeof value === "object" && value !== null)) {
    return;
  }
  const id: unknown = Reflect.get(value, "id");
  return typeof id === "string" ? id : undefined;
}

/**
 * 从 CodeView items 账本捕获视口顶部锚点，不依赖 renderState。
 * viewportOffset 含 paddingTop，与 scrollToItem 的 offset 语义一致。
 *
 * Pierre 把 items / getLayout 声明为 private；这里用 Reflect 读取运行时字段，
 * 避免把整块布局强转成 `never` 逃避类型检查。
 */
export function captureDiffVirtualLayoutAnchor(
  viewer: unknown
): DiffVirtualLayoutAnchor | null {
  if (!isObjectSource(viewer)) {
    return null;
  }
  const items = readItems(viewer);
  const height = readNumberMethod(viewer, "getHeight") ?? 0;
  const scrollTop = readNumberMethod(viewer, "getScrollTop");
  if (items.length === 0 || height <= 0 || scrollTop === undefined) {
    return null;
  }
  const paddingTop = readPaddingTop(viewer);
  let candidate: DiffVirtualLayoutItem | undefined;
  for (const item of items) {
    if (paddingTop + item.top > scrollTop + 0.5) {
      break;
    }
    candidate = item;
  }
  candidate ??= items[0];
  if (!candidate) {
    return null;
  }
  const id = readItemId(candidate);
  if (id === undefined) {
    return null;
  }
  return {
    id,
    viewportOffset: paddingTop + candidate.top - scrollTop,
  };
}

/**
 * 目标 item 相对滚动视口顶部的偏移（CSS px）。
 * 几何缺失或非有限时返回 null；只用于揭示事务判定，不得据此硬写 scrollTop。
 */
export function diffViewItemViewportOffset(
  top: number | undefined,
  scrollTop: number | undefined
): number | null {
  if (
    typeof top !== "number" ||
    typeof scrollTop !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(scrollTop)
  ) {
    return null;
  }
  return top - scrollTop;
}

/**
 * 只把锚点写入引擎的 pendingLayoutAnchor，绝不直接写 scrollTop。
 * 已有 pending 锚点 / 目标 / 动画、隐藏视口或锚点 item 已消失时拒绝播种。
 */
export function seedPendingDiffLayoutAnchor(
  viewer: unknown,
  anchor: DiffVirtualLayoutAnchor | null
): boolean {
  if (!(isObjectSource(viewer) && anchor)) {
    return false;
  }
  if (
    (readNumberMethod(viewer, "getHeight") ?? 0) <= 0 ||
    Reflect.get(viewer, "pendingLayoutAnchor") != null ||
    Reflect.get(viewer, "pendingScrollTarget") != null ||
    Reflect.get(viewer, "scrollAnimation") != null ||
    !readItems(viewer).some((item) => readItemId(item) === anchor.id)
  ) {
    return false;
  }
  return Reflect.set(viewer, "pendingLayoutAnchor", {
    id: anchor.id,
    type: "item",
    viewportOffset: anchor.viewportOffset,
  });
}
