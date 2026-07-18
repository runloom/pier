/**
 * 右键菜单跨进程类型契约. renderer 构建 MenuTemplate → preload IPC → main Zod 校验 →
 * Electron Menu.popup. 用户选中后 main resolve actionId (或 null = 关闭未选中).
 *
 * role 白名单 14 个 — Electron 原生编辑/窗口操作, 不走 actionRegistry handler.
 * 列举所有允许的 role 是为防 main 端拼 menu 时被 renderer 注入 quit/openDevTools 等
 * 高权限 role (template injection 防御).
 */
export const ALLOWED_ROLES = [
  "cut",
  "copy",
  "paste",
  "pasteAndMatchStyle",
  "selectAll",
  "undo",
  "redo",
  "delete",
  "resetZoom",
  "zoomIn",
  "zoomOut",
  "togglefullscreen",
  "minimize",
  "close",
] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

export interface MenuItemSeparator {
  type: "separator";
}

export interface MenuItemRole {
  enabled?: boolean;
  /** 用户可见 label, 缺省走 Electron 内置. */
  label?: string;
  role: AllowedRole;
  type: "role";
}

export interface MenuItemAction {
  /** Electron accelerator 格式 (例: "CmdOrCtrl+Shift+P"). 仅显示, 不绑定快捷键. */
  accelerator?: string;
  /**
   * 点击时由 main 直接写入系统剪贴板。
   * 用于「复制选区」：原生菜单会抢焦点，renderer 再读选区常已空；
   * 在弹菜单前把文本钉到菜单项上，click 时立刻 writeText。
   */
  clipboardText?: string;
  enabled?: boolean;
  /** actionRegistry.get(id) 查 handler, click 回传时用. */
  id: string;
  label: string;
  type: "action";
}

export interface MenuItemCheckbox {
  /** 当前勾选态(菜单是一次性快照,点击后由调用方落库并重开). */
  checked: boolean;
  enabled?: boolean;
  /** popup resolve 回传此 id,由调用方自行 dispatch(不必经 actionRegistry). */
  id: string;
  label: string;
  type: "checkbox";
}

export interface MenuItemSubmenu {
  enabled?: boolean;
  label: string;
  submenu: MenuItem[];
  type: "submenu";
}

export type MenuItem =
  | MenuItemSeparator
  | MenuItemRole
  | MenuItemAction
  | MenuItemCheckbox
  | MenuItemSubmenu;

export type MenuTemplate = readonly MenuItem[];

/** Menu.popup 位置. 缺省由 Electron 用当前光标位置. 坐标系: BrowserWindow contentView. */
export interface MenuPopupOptions {
  x?: number;
  y?: number;
}

export interface MenuPopupResult {
  /** action id (action 项被选中) / null (用户 Esc 或点击外部关闭). role 项不回传. */
  actionId: string | null;
}

/**
 * 安全限制 — main 端 Zod 校验, 与 schema 一一对应:
 *   - top-level ≤ 50 项
 *   - submenu 深度 ≤ 5
 *   - 每层 ≤ 50 项
 *   - label / id ≤ 256 字符
 *   - accelerator ≤ 64 字符
 *   - clipboardText ≤ 1_048_576 字符
 */
export const MENU_LIMITS = {
  topLevelMax: 50,
  submenuMaxDepth: 5,
  itemsPerLevelMax: 50,
  labelMaxLength: 256,
  idMaxLength: 256,
  acceleratorMaxLength: 64,
  clipboardTextMaxLength: 1_048_576,
} as const;
