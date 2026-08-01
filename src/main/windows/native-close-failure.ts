import { createLogger } from "@shared/logger.ts";
import {
  app,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";

export interface NativeWindowCloseFailure {
  closeError: unknown;
  feedbackError: unknown;
  windowId: string;
}

export type NativeWindowCloseFailureDecision = "force-close" | "dismiss";

const log = createLogger("window.close");

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isChineseLocale(): boolean {
  return app.getLocale().toLowerCase().startsWith("zh");
}

export function isRendererUnreachableCloseError(error: unknown): boolean {
  const text = message(error).toLowerCase();
  return (
    text.includes("renderer command timed out") ||
    text.includes("no renderer window available")
  );
}

/**
 * renderer 反馈通道失败、且**不是** IPC 超时类不可达错误时使用。
 * （超时 / no renderer 由 close-preparation 自动强制关窗，不再弹此框。）
 * 提供「强制关闭」以免其它关窗失败路径永远 veto。
 * 返回用户选择；调用方在 force-close 时应 best-effort 刷 main 状态后放行关窗。
 */
export async function showNativeWindowCloseFailure(
  input: NativeWindowCloseFailure,
  showMessageBox: (
    options: MessageBoxOptions
  ) => Promise<MessageBoxReturnValue> = (options) =>
    dialog.showMessageBox(options)
): Promise<NativeWindowCloseFailureDecision> {
  const isChinese = isChineseLocale();
  const closeMessage = message(input.closeError);
  const feedbackMessage = message(input.feedbackError);
  log.error("native-close-failure-prompt", {
    closeError: closeMessage,
    feedbackError: feedbackMessage,
    windowId: input.windowId,
  });

  const { response } = await showMessageBox({
    buttons: isChinese
      ? ["强制关闭窗口", "取消"]
      : ["Force close window", "Cancel"],
    cancelId: 1,
    defaultId: 0,
    detail: isChinese
      ? `${closeMessage}\n\n界面提示也未能显示：\n${feedbackMessage}\n\n强制关闭可能无法保存未落盘的布局；草稿等 main 侧状态仍会尽量写入。`
      : `${closeMessage}\n\nThe in-app error could not be shown:\n${feedbackMessage}\n\nForce close may skip unsaved layout persistence; main-side state is still flushed best-effort.`,
    message: isChinese
      ? "界面无响应，无法安全完成关窗准备。"
      : "The interface is unresponsive, so the window could not close safely.",
    noLink: true,
    title: isChinese ? "无法关闭窗口" : "Unable to close window",
    type: "error",
  });

  const decision: NativeWindowCloseFailureDecision =
    response === 0 ? "force-close" : "dismiss";
  log.info("native-close-failure-decision", {
    decision,
    windowId: input.windowId,
  });
  return decision;
}
