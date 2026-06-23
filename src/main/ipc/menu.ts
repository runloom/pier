/**
 * pier:menu:popup IPC — renderer 通过 contextBridge 提交 MenuTemplate, main 在
 * BrowserWindow 上弹原生菜单. resolve 返回用户选中的 actionId (action 项) 或 null
 * (Esc / 点击外部 / role 项).
 *
 * 安全: 任何 schema 不合法的 template 立即 reject, 不调 Menu.popup; role 仅允许
 * ALLOWED_ROLES 白名单, 防 renderer 注入 quit 等高权限操作.
 *
 * 时序: Menu.popup 是同步弹出 + 异步响应, 用 menu-will-close 事件标识菜单消失,
 * 通过 click 闭包捕获选中的 actionId. setImmediate resolve 让 close 后的 OS
 * 焦点回归先完成, 再 resolve renderer 端 Promise.
 */
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
  MenuItem as PierMenuItem,
} from "@shared/contracts/menu.ts";
import {
  BrowserWindow,
  type IpcMain,
  Menu,
  type MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
import { MenuTemplateSchema } from "../menu/template-schema.ts";

function toMenuItem(
  item: PierMenuItem,
  onPicked: (id: string) => void
): MenuItemConstructorOptions {
  if (item.type === "separator") {
    return { type: "separator" };
  }
  if (item.type === "role") {
    return {
      role: item.role,
      ...(item.label !== undefined && { label: item.label }),
      enabled: item.enabled ?? true,
    };
  }
  if (item.type === "submenu") {
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      submenu: item.submenu.map((child) => toMenuItem(child, onPicked)),
    };
  }
  // action
  return {
    label: item.label,
    ...(item.accelerator !== undefined && { accelerator: item.accelerator }),
    enabled: item.enabled ?? true,
    click: (_menuItem: MenuItem) => {
      onPicked(item.id);
    },
  };
}

export function registerMenuIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    "pier:menu:popup",
    (
      event,
      rawTemplate: unknown,
      rawOptions: unknown
    ): Promise<MenuPopupResult> => {
      let template: MenuTemplate;
      try {
        template = MenuTemplateSchema.parse(rawTemplate);
      } catch (err) {
        console.error("[menu] template schema rejected:", err);
        return Promise.resolve({ actionId: null });
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return Promise.resolve({ actionId: null });
      }

      // options 可选 — undefined / null 走 Electron 默认 (光标位置).
      const options: MenuPopupOptions =
        rawOptions && typeof rawOptions === "object"
          ? (rawOptions as MenuPopupOptions)
          : {};

      return new Promise<MenuPopupResult>((resolve) => {
        let pickedId: string | null = null;
        const items = template.map((item) =>
          toMenuItem(item, (id) => {
            pickedId = id;
          })
        );
        const menu = Menu.buildFromTemplate(items);
        // menu-will-close 在用户选中 (click 已经 fire) 或关闭 (Esc / 外部点击) 后触发.
        // setImmediate 让 click handler 先 run 完, pickedId 才反映真实选择.
        // 用 once: single-fire 语义显式 — 即使某些 Electron 版本对嵌套 submenu 多 fire,
        // resolve 也只发一次, 不留 setImmediate 余炮.
        menu.once("menu-will-close", () => {
          setImmediate(() => resolve({ actionId: pickedId }));
        });
        const popupOpts: { window: BrowserWindow; x?: number; y?: number } = {
          window: win,
        };
        if (typeof options.x === "number" && typeof options.y === "number") {
          popupOpts.x = Math.round(options.x);
          popupOpts.y = Math.round(options.y);
        }
        menu.popup(popupOpts);
      });
    }
  );
}
