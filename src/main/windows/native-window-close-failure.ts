import { app, dialog } from "electron";

export interface NativeWindowCloseFailure {
  closeError: unknown;
  feedbackError: unknown;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** renderer 反馈通道也失败时才使用，避免正常关闭否决出现双提示。 */
export function showNativeWindowCloseFailure({
  closeError,
  feedbackError,
}: NativeWindowCloseFailure): void {
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  dialog.showErrorBox(
    isChinese ? "无法关闭窗口" : "Unable to close window",
    `${message(closeError)}\n\n${isChinese ? "界面提示也未能显示：" : "The in-app error could not be shown:"}\n${message(feedbackError)}`
  );
}
