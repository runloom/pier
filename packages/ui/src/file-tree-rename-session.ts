import type { FileTree } from "@pierre/trees";
import { type FileTreeRefs, readRenameView } from "./file-tree-internal.ts";
import { stripTrailingSlash } from "./file-tree-model.ts";

export interface FileTreeRenameDeliveryRef {
  current: (() => void) | null;
}

export type FileTreeRenameModel = Pick<
  FileTree,
  "getItem" | "onMutation" | "subscribe"
>;

/** 观察新建占位项的首次重命名，不改写已提交的业务回调快照。 */
export class FileTreeRenameSession {
  readonly deliveryRef: FileTreeRenameDeliveryRef = { current: null };
  #activeCleanup: (() => void) | null = null;

  begin({
    callerPath,
    isFolder,
    model,
    officialPath,
    readRefs,
  }: {
    callerPath: string;
    isFolder: boolean;
    model: FileTreeRenameModel;
    officialPath: string;
    readRefs: () => FileTreeRefs;
  }): void {
    this.dispose();
    let settled = false;
    let unsubscribeMutation: () => void = () => undefined;
    let unsubscribeSubscribe: () => void = () => undefined;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (this.deliveryRef.current === markRenameDelivered) {
        this.deliveryRef.current = null;
      }
      if (this.#activeCleanup === settle) {
        this.#activeCleanup = null;
      }
      unsubscribeMutation();
      unsubscribeSubscribe();
    };
    const markRenameDelivered = () => settle();

    this.deliveryRef.current = markRenameDelivered;
    const mutationCleanup = model.onMutation("remove", (event) => {
      if (settled) {
        return;
      }
      const removed = stripTrailingSlash(event.path);
      if (
        removed !== callerPath &&
        removed !== stripTrailingSlash(officialPath)
      ) {
        return;
      }
      settle();
      readRefs().onModelPathsRemoved?.([callerPath]);
    });
    if (settled) {
      mutationCleanup();
    } else {
      unsubscribeMutation = mutationCleanup;
    }
    const subscriptionCleanup = model.subscribe(() => {
      if (settled) {
        return;
      }
      const renameView = readRenameView(model);
      if (!renameView || renameView.isActive()) {
        return;
      }
      const stillPresent = Boolean(
        model.getItem(officialPath) || model.getItem(callerPath)
      );
      if (stillPresent) {
        settle();
        readRefs().onRenamePath?.({
          from: callerPath,
          isFolder,
          to: callerPath,
        });
        return;
      }
      // Pierre 先通知普通订阅，再发送同栈 remove mutation。延迟兜底可让
      // mutation 成为取消路径的唯一正常完成者，同时覆盖没有 mutation 的移除。
      queueMicrotask(() => {
        if (
          settled ||
          model.getItem(officialPath) ||
          model.getItem(callerPath)
        ) {
          return;
        }
        settle();
        readRefs().onModelPathsRemoved?.([callerPath]);
      });
    });
    if (settled) {
      subscriptionCleanup();
    } else {
      unsubscribeSubscribe = subscriptionCleanup;
      this.#activeCleanup = settle;
    }
  }

  dispose(): void {
    this.#activeCleanup?.();
  }
}
