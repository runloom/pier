import type { AppWindow } from "../windows/app-window.ts";
import {
  findInternalWindowId,
  findWindowContext,
} from "../windows/window-identity.ts";

/**
 * 窗口 → 终端 session 持久化作用域 = 窗口 record UUID（跨重启稳定）。
 *
 * 历史上这里返回运行时窗口 id（"main"/"w-1"），与函数名不符：运行时 id
 * 按启动分配顺序发放，跨重启会漂移（多窗口下 session 串线），panel-transfer
 * 冷恢复也无法用它寻址。现在与 window-record-state / 布局 / Files 草稿 /
 * 迁移 journal 同一键词汇。legacy 键由启动时
 * migrateTerminalSessionScopesToRecordIds 迁移。未注册时抛异常——不应走到。
 */
export function windowRecordIdFor(win: AppWindow): string {
  const context = findWindowContext(win);
  if (context === null) {
    throw new Error("window not registered");
  }
  return context.recordId;
}

/** 调试日志用稳定窗口标识（运行时 id，如 "main"）。未注册时抛异常。 */
export function stableWindowIdFor(win: AppWindow): string {
  const id = findInternalWindowId(win);
  if (id === null) {
    throw new Error("window not registered");
  }
  return id;
}
