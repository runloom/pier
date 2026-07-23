import type { CodeViewHandle } from "@pierre/diffs/react";
import type { RefObject } from "react";
import type { PierDiffViewItem } from "./diff-view-items.ts";
import type { PierDiffViewAnchor } from "./use-diff-view-handle.ts";

export interface TopologyScrollRestore {
  readonly anchor: PierDiffViewAnchor;
  readonly path: string | null;
  readonly scrollTop: number;
}

/** Capture viewport while previous CodeView is still mounted (render phase). */
export function captureTopologyScrollRestore(input: {
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly inputs: readonly PierDiffViewItem[];
  readonly previousTopologyKey: string | null;
  readonly topologyKey: string;
  readonly topologyScrollRestoreRef: RefObject<TopologyScrollRestore | null>;
}): void {
  const {
    codeViewRef,
    inputs,
    previousTopologyKey,
    topologyKey,
    topologyScrollRestoreRef,
  } = input;
  if (
    previousTopologyKey === null ||
    previousTopologyKey === topologyKey ||
    topologyScrollRestoreRef.current !== null
  ) {
    return;
  }
  const viewer = codeViewRef.current?.getInstance();
  const container = viewer?.getContainerElement();
  const rendered = viewer?.getRenderedItems() ?? [];
  if (!(viewer && container && rendered.length > 0)) {
    return;
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
  if (!candidate) {
    return;
  }
  const match = inputs.find((entry) => entry.id === candidate.id);
  topologyScrollRestoreRef.current = {
    anchor: {
      id: candidate.id,
      offset: viewer.getLocalTopForInstance(candidate.instance) - scrollTop,
    },
    path: match?.fileDisplay?.path ?? null,
    scrollTop,
  };
}

export function restoreTopologyScroll(input: {
  readonly codeViewKey: string;
  readonly codeViewItemsLength: number;
  readonly codeViewRef: RefObject<CodeViewHandle<undefined> | null>;
  readonly inputs: readonly PierDiffViewItem[];
  readonly scheduleRenderWindowReport: () => void;
  readonly topologyScrollRestoreRef: RefObject<TopologyScrollRestore | null>;
}): void {
  const pending = input.topologyScrollRestoreRef.current;
  if (!pending || input.codeViewKey.length === 0) {
    return;
  }
  if (input.codeViewItemsLength === 0 && input.inputs.length > 0) {
    return;
  }
  const viewer = input.codeViewRef.current;
  const instance = viewer?.getInstance();
  const container = instance?.getContainerElement();
  if (!(viewer && instance && container)) {
    return;
  }

  const restoreById = (id: string, offset: number): boolean => {
    if (!viewer.getItem(id)) {
      return false;
    }
    viewer.scrollTo({
      align: "start",
      behavior: "instant",
      id,
      offset,
      type: "item",
    });
    return true;
  };

  let restored = restoreById(pending.anchor.id, pending.anchor.offset);
  if (!restored && pending.path) {
    const match = input.inputs.find(
      (item) => item.fileDisplay?.path === pending.path
    );
    if (match) {
      restored = restoreById(match.id, pending.anchor.offset);
    }
  }
  if (!restored) {
    const maxScroll = Math.max(
      0,
      container.scrollHeight - container.clientHeight
    );
    container.scrollTop = Math.min(pending.scrollTop, maxScroll);
  }
  input.topologyScrollRestoreRef.current = null;
  input.scheduleRenderWindowReport();
}
