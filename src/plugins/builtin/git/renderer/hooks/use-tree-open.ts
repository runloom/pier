import type { GitReviewGroup } from "@shared/contracts/git/review.ts";
import { type RefObject, useCallback, useRef } from "react";
import { isReviewSlotIncludedInBody } from "../review/document/body-class.ts";
import type {
  GitReviewTreeFileRef,
  gitReviewTreeModel,
} from "../review/tree.tsx";

/**
 * 树点击 / 右键 Inspect·Command：B-Select 打开 + Command 会话禁导航与 CodeView freeze。
 */
export function useGitReviewTreeOpen(options: {
  readonly beginNavigation: (target: {
    readonly entryKey: string;
    readonly sectionKey: string;
  }) => void;
  readonly cancelVerification: () => void;
  readonly getSelectedEntryKey: () => string | null;
  readonly getSelectedSectionKey: () => string | null;
  readonly onActivateGroup?: (group: GitReviewGroup) => void;
  readonly onRequestOpen?: (fileRef: GitReviewTreeFileRef) => void;
  readonly setSelectedTreeTarget: (
    target: {
      readonly entryKey: string;
      readonly sectionKey: string;
    } | null
  ) => void;
  readonly treeModel: ReturnType<typeof gitReviewTreeModel>;
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
    getSelectedEntryKey,
    getSelectedSectionKey,
    onActivateGroup,
    onRequestOpen,
    setSelectedTreeTarget,
    treeModel,
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
      if (onRequestOpen) {
        onRequestOpen(fileRef);
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
      onActivateGroup?.(fileRef.group);
      // 金标准：meta 槽仅侧栏选中，不 materialize、不假 scroll；notice 进正文可滚
      const entry = treeModel.entryByKey.get(fileRef.entryKey);
      const slot = entry?.renderSlots.find(
        (candidate) => candidate.sectionKey === fileRef.sectionKey
      );
      if (slot !== undefined && !isReviewSlotIncludedInBody(slot)) {
        return;
      }
      // 只标 pending + boost demand；scroll 在 projection-commit / pending layout
      beginNavigation({
        entryKey: fileRef.entryKey,
        sectionKey: fileRef.sectionKey,
      });
    },
    [
      beginNavigation,
      getSelectedEntryKey,
      getSelectedSectionKey,
      onActivateGroup,
      onRequestOpen,
      setSelectedTreeTarget,
      treeModel,
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
  const onContextMenuSession = useCallback(
    (
      phase: "begin" | "end",
      detail: { readonly intent: "inspect" | "command"; readonly path: string }
    ) => {
      if (detail.intent !== "command") {
        commandMenuSessionRef.current = false;
        return;
      }
      if (phase === "begin") {
        commandMenuSessionRef.current = true;
        cancelVerification();
        return;
      }
      commandMenuSessionRef.current = false;
    },
    [cancelVerification]
  );
  return {
    commandMenuSessionRef,
    isActiveOpenPath,
    onContextMenuSession,
    openTreeNode,
  };
}
