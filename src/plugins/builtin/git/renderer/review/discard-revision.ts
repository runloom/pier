/**
 * discard（破坏性）所需的乐观并发令牌获取。
 *
 * 折叠态不预取正文，所以点击「放弃更改」时投影里可能还没有令牌。此时按需读一次
 * 文档：请求与确认弹窗并行发出，令牌反映「用户做决定那一刻」的状态，main 在写入前
 * 再比一次，正好覆盖弹窗停留期间被外部改写的情况。
 *
 * 不要把令牌当作「按钮是否可用」的前置条件——那会让按钮随正文逐个解锁。
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitReviewFileDocumentRequest } from "@shared/contracts/git-review/document.ts";
import { pluginText } from "../plugin-text.ts";

export function requestDiscardRevision(options: {
  readonly cachedRevision: string | undefined;
  readonly context: RendererPluginContext;
  readonly operationId: string;
  readonly source: GitReviewFileDocumentRequest["source"];
}): Promise<string | undefined> {
  if (options.cachedRevision !== undefined) {
    return Promise.resolve(options.cachedRevision);
  }
  return options.context.git
    .getReviewFileDocument({
      operationId: options.operationId,
      source: options.source,
    })
    .then((result) => (result.kind === "ok" ? result.revision : undefined))
    .catch(() => undefined);
}

/** 拿不到 discard 并发令牌时阻断写入，避免无 expectedRevision 的破坏性操作。 */
export function alertDiscardRevisionUnavailable(
  context: RendererPluginContext
): Promise<void> {
  return context.dialogs.alert({
    body: pluginText(
      context,
      "reviewDiscardRevisionUnavailableBody",
      "Pier could not confirm this file's current state. Please try again."
    ),
    title: pluginText(
      context,
      "reviewDiscardFailed",
      "Unable to discard changes"
    ),
  });
}
