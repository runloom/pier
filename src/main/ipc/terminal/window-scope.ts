import type { WebContents } from "electron";
import type { AppWindow } from "../../windows/app-window.ts";
import {
  findAppWindowByElectronId,
  findAppWindowByWebContents,
  findInternalWindowId,
  findWindowContext,
} from "../../windows/identity.ts";

export function windowFromWebContents(
  webContents: WebContents
): AppWindow | null {
  return findAppWindowByWebContents(webContents);
}

const electronIdToRecordId = new Map<string, string>();

export function rememberElectronWindowRecordId(
  electronWindowId: string,
  recordId: string
): void {
  if (electronWindowId.length === 0 || recordId.length === 0) {
    return;
  }
  electronIdToRecordId.set(electronWindowId, recordId);
}

export function rememberedRecordIdForElectronWindowId(
  electronWindowId: string
): string | undefined {
  return electronIdToRecordId.get(electronWindowId);
}

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
  rememberElectronWindowRecordId(String(win.id), context.recordId);
  return context.recordId;
}

/**
 * FA / hook 侧 `PIER_WINDOW_ID`（Electron `BrowserWindow.id` 数字串）→ session
 * 持久化 record UUID。活窗走注册表；已毁或不存在时回落到进程内
 * electronId → recordId 映射，避免拆窗后迟到 hook 丢掉 session id。
 */
export function windowRecordIdForElectronWindowId(
  electronWindowId: string | number
): string | null {
  const id =
    typeof electronWindowId === "number"
      ? electronWindowId
      : Number(electronWindowId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const win = findAppWindowByElectronId(id);
  if (win && !win.isDestroyed()) {
    try {
      return windowRecordIdFor(win);
    } catch {
      // fall through to the durable map
    }
  }
  return rememberedRecordIdForElectronWindowId(String(id)) ?? null;
}

/** 调试日志用稳定窗口标识（运行时 id，如 "main"）。未注册时抛异常。 */
export function stableWindowIdFor(win: AppWindow): string {
  const id = findInternalWindowId(win);
  if (id === null) {
    throw new Error("window not registered");
  }
  return id;
}
