/**
 * pier:menu:popup IPC — renderer 通过 contextBridge 提交 MenuTemplate, main 在
 * app window 上弹原生菜单. resolve 返回用户选中的 actionId (action 项) 或 null
 * (Esc / 点击外部 / role 项).
 *
 * 安全: 任何 schema 不合法的 template 立即 reject, 不调 Menu.popup; role 仅允许
 * ALLOWED_ROLES 白名单, 防 renderer 注入 quit 等高权限操作.
 *
 * 时序: MenuItem.click 记录选择，popup.callback 记录原生菜单已关闭；两者经幂等
 * 完成器汇合。不能在 click 内立即完成 IPC：macOS 菜单此时仍处于 tracking loop，
 * renderer 立即重入命令执行会出现点击成功但界面不更新。关闭但尚未观察到选择时
 * 延后一轮 Node 事件循环结算取消，以兼容平台回调先后差异，不使用毫秒计时猜测。
 */
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
  MenuItem as PierMenuItem,
} from "@shared/contracts/menu.ts";
import {
  type BaseWindow,
  clipboard,
  type IpcMain,
  Menu,
  type MenuItem,
  type MenuItemConstructorOptions,
  type PopupOptions,
} from "electron";
import { MenuTemplateSchema } from "../menu/template-schema.ts";
import { windowManager } from "../windows/window-manager.ts";

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
  if (item.type === "checkbox") {
    return {
      type: "checkbox",
      checked: item.checked,
      label: item.label,
      enabled: item.enabled ?? true,
      click: (_menuItem: MenuItem) => {
        onPicked(item.id);
      },
    };
  }
  // action
  return {
    label: item.label,
    ...(item.accelerator !== undefined && { accelerator: item.accelerator }),
    enabled: item.enabled ?? true,
    click: (_menuItem: MenuItem) => {
      // 先写系统剪贴板，再回传 actionId。原生菜单 click 时 renderer 选区常已空。
      if (
        typeof item.clipboardText === "string" &&
        item.clipboardText.length > 0
      ) {
        clipboard.writeText(item.clipboardText);
      }
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

      const win = windowManager.fromWebContents(event.sender);
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
        let closed = false;
        let settled = false;
        const settle = (actionId: string | null) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({ actionId });
        };
        const items = template.map((item) =>
          toMenuItem(item, (id) => {
            pickedId = id;
            if (closed) {
              settle(id);
            }
          })
        );
        const menu = Menu.buildFromTemplate(items);
        const popupOpts: PopupOptions & { window: BaseWindow } = {
          callback: () => {
            closed = true;
            if (pickedId) {
              settle(pickedId);
              return;
            }
            setImmediate(() => settle(pickedId));
          },
          window: win.host,
        };
        // 必须 isFinite 否则 NaN/Infinity 通过 typeof 守卫, Math.round(NaN)=NaN 传给
        // Menu.popup 行为未定义 (部分平台让 popup 永不弹出, popup.callback 不执行,
        // 这个 IPC promise 永久挂起).
        if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
          popupOpts.x = Math.round(options.x as number);
          popupOpts.y = Math.round(options.y as number);
        }
        menu.popup(popupOpts);
      });
    }
  );
}
