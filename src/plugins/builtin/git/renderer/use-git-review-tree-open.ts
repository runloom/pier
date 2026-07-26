import type { PierDiffViewHandle } from "@pier/ui/diff-view.tsx";
import { type RefObject, useCallback, useRef } from "react";
import type { gitReviewTreeModel } from "./git-review-tree.tsx";

/**
 * 树点击 / 右键 Inspect·Command：B-Select 打开 + Command 会话禁导航与 CodeView freeze。
 */
export function useGitReviewTreeOpen(options: {
  readonly beginNavigation: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly cancelVerification: () => void;
  readonly diffHandleRef: RefObject<PierDiffViewHandle | null>;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
  readonly setSelectedTreeTarget: (
    target: {
      readonly entryKey: string;
      readonly sectionKey: string;
    } | null
  ) => void;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
  readonly tryPendingNavigation: () => void;
}): {
  readonly commandMenuSessionRef: RefObject<boolean>;
  readonly isActiveOpenPath: (path: string) => boolean;
  readonly onContextMenuSession: (
    phase: "begin" | "end",
    detail: {
      readonly intent: "inspect" | "command";
      readonly path: string;
    }
  ) => void;
  readonly openTreeNode: (path: string) => void;
} {
  const {
    beginNavigation,
    cancelVerification,
    diffHandleRef,
    getSelectedEntryKey,
    getSelectedSectionKey,
    setSelectedTreeTarget,
    treeModel,
    tryPendingNavigation,
  } = options;
  /** Command 菜单会话：禁止任何导航/scrollToItem。 */
  const commandMenuSessionRef = useRef(false);
  const openTreeNode = useCallback(
    (path: string) => {
      if (commandMenuSessionRef.current) {
        return;
      }
      if (path.startsWith("group:") && path.split("/").length === 1) {
        return;
      }
      const fileRef = treeModel.getFileRefForTreePath(path);
      if (!fileRef) {
        return;
      }
      const alreadyOpen =
        getSelectedEntryKey() === fileRef.entryKey &&
        getSelectedSectionKey() === fileRef.sectionKey;
      // 已打开同一 section：硬 no-op（含 setState），避免 revealPath 双写抖树。
      if (alreadyOpen) {
        return;
      }
      setSelectedTreeTarget({
        entryKey: fileRef.entryKey,
        sectionKey: fileRef.sectionKey,
      });
      beginNavigation({
        entryKey: fileRef.entryKey,
        sectionKey: fileRef.sectionKey,
      });
      tryPendingNavigation();
    },
    [
      beginNavigation,
      getSelectedEntryKey,
      getSelectedSectionKey,
      setSelectedTreeTarget,
      treeModel,
      tryPendingNavigation,
    ]
  );
  /** 树 path → 是否已是 B-Select 打开目标（Command 判定，不依赖 L-Select）。 */
  const isActiveOpenPath = useCallback(
    (path: string) => {
      const fileRef = treeModel.getFileRefForTreePath(path);
      if (!fileRef) {
        return false;
      }
      return (
        getSelectedEntryKey() === fileRef.entryKey &&
        getSelectedSectionKey() === fileRef.sectionKey
      );
    },
    [getSelectedEntryKey, getSelectedSectionKey, treeModel]
  );
  /**
   * Command 菜单：持续 rAF 钉 CodeView raw scrollTop，挡住 sticky/nav 任意回顶。
   * Inspect：不 freeze。
   */
  const codeViewScrollFreezeRef = useRef<{
    top: number;
    stop: () => void;
  } | null>(null);
  const onContextMenuSession = useCallback(
    (
      phase: "begin" | "end",
      detail: { readonly intent: "inspect" | "command"; readonly path: string }
    ) => {
      if (detail.intent !== "command") {
        codeViewScrollFreezeRef.current?.stop();
        codeViewScrollFreezeRef.current = null;
        commandMenuSessionRef.current = false;
        return;
      }
      const handle = diffHandleRef.current;
      if (phase === "begin") {
        commandMenuSessionRef.current = true;
        cancelVerification();
        const top = handle?.getScrollTop();
        if (top === null || top === undefined || !handle) {
          codeViewScrollFreezeRef.current = null;
          return;
        }
        let active = true;
        const pin = () => {
          if (!active) {
            return;
          }
          handle.setScrollTop(top);
          requestAnimationFrame(pin);
        };
        requestAnimationFrame(pin);
        codeViewScrollFreezeRef.current = {
          top,
          stop: () => {
            active = false;
            handle.setScrollTop(top);
          },
        };
        return;
      }
      commandMenuSessionRef.current = false;
      const session = codeViewScrollFreezeRef.current;
      codeViewScrollFreezeRef.current = null;
      session?.stop();
      if (session && handle) {
        requestAnimationFrame(() => {
          handle.setScrollTop(session.top);
          requestAnimationFrame(() => {
            handle.setScrollTop(session.top);
          });
        });
      }
    },
    [cancelVerification, diffHandleRef]
  );
  return {
    commandMenuSessionRef,
    isActiveOpenPath,
    onContextMenuSession,
    openTreeNode,
  };
}
