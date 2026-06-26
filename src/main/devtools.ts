import {
  app,
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

export const DETACHED_DEVTOOLS_ACCELERATOR = "CommandOrControl+Alt+I";

const NS_FLAG_SHIFT = 0x2_00_00;
const NS_FLAG_CONTROL = 0x4_00_00;
const NS_FLAG_OPTION = 0x8_00_00;
const NS_FLAG_COMMAND = 0x10_00_00;

type DevToolsWebContentsLike = Pick<
  WebContents,
  "closeDevTools" | "isDestroyed" | "isDevToolsOpened" | "on" | "openDevTools"
>;

interface DevToolsWindowLike {
  focus: () => void;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  moveTop: () => void;
  restore: () => void;
  webContents: DevToolsWebContentsLike;
}

function hasFlag(flags: number, flag: number): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: NSEvent modifier flags are bitmasks.
  return (flags & flag) !== 0;
}

function isKeyI(key: string, code: string): boolean {
  return code === "KeyI" || key.toLowerCase() === "i";
}

export function isToggleDevToolsInput(input: Input): boolean {
  if (input.type !== "keyDown" || input.isComposing || input.isAutoRepeat) {
    return false;
  }
  if (!isKeyI(input.key, input.code)) {
    return false;
  }

  if (process.platform === "darwin") {
    return input.meta && input.alt && !input.control && !input.shift;
  }

  return input.control && input.alt && !input.meta && !input.shift;
}

export function isToggleDevToolsNativeChord(
  modifierFlags: number,
  chars: string
): boolean {
  if (process.platform !== "darwin" || chars.toLowerCase() !== "i") {
    return false;
  }

  return (
    hasFlag(modifierFlags, NS_FLAG_COMMAND) &&
    hasFlag(modifierFlags, NS_FLAG_OPTION) &&
    !hasFlag(modifierFlags, NS_FLAG_CONTROL) &&
    !hasFlag(modifierFlags, NS_FLAG_SHIFT)
  );
}

export function toggleDetachedDevTools(win: DevToolsWindowLike): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
    return;
  }

  win.webContents.openDevTools({
    activate: true,
    mode: "detach",
    title: "Pier DevTools",
  });
}

export function createDetachedDevToolsMenuItem(
  getFocusedWindow: () => DevToolsWindowLike | null,
  label = "Toggle Developer Tools"
): MenuItemConstructorOptions {
  return {
    accelerator: DETACHED_DEVTOOLS_ACCELERATOR,
    click: () => {
      const win = getFocusedWindow();
      if (win) {
        toggleDetachedDevTools(win);
      }
    },
    label,
  };
}

export function installDetachedDevToolsHandlers(
  win: DevToolsWindowLike,
  restoreFocus: () => void
): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (!isToggleDevToolsInput(input)) {
      return;
    }
    event.preventDefault();
    toggleDetachedDevTools(win);
  });

  win.webContents.on("devtools-closed", () => {
    for (const delay of [0, 50, 150, 300]) {
      setTimeout(() => {
        if (win.isDestroyed()) {
          return;
        }
        if (win.isMinimized()) {
          win.restore();
        }
        app.focus({ steal: true });
        win.moveTop();
        win.focus();
        restoreFocus();
      }, delay);
    }
  });
}
