import type { PierDiffViewAnchor } from "./diff-view-handle-types.ts";

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
