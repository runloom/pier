import { app } from "electron";

/** 退出失败的用户可读摘要（含 AggregateError 逐项展开），按系统语言双语。 */
export function formatQuitFailure(error: unknown): string {
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  if (!(error instanceof Error)) return String(error);
  let summary = error.message;
  if (summary === "window close preparation failed") {
    summary = isChinese
      ? "窗口关闭准备失败"
      : "Window close preparation failed";
  }
  if (!(error instanceof AggregateError)) return summary;
  const details = error.errors.map((item) =>
    item instanceof Error ? item.message : String(item)
  );
  return [summary, ...details].join("\n");
}
