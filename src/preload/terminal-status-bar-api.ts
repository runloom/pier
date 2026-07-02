import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  TerminalStatusBarItemOverride,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";

export interface PierTerminalStatusBarPrefsAPI {
  getAll: () => Promise<TerminalStatusBarPrefs>;
  /** 订阅 main 广播的完整快照(含发起窗口自身)。返回解绑函数。 */
  onChanged: (cb: (prefs: TerminalStatusBarPrefs) => void) => () => void;
  resetItem: (itemId: string) => Promise<TerminalStatusBarPrefs>;
  setItemOverride: (
    itemId: string,
    override: TerminalStatusBarItemOverride
  ) => Promise<TerminalStatusBarPrefs>;
}

// 与 index.ts / git-api.ts 同款 envelope 解包(独立文件避免 index.ts 触 500 行上限)。
async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

export const terminalStatusBarPrefsApi: PierTerminalStatusBarPrefsAPI = {
  getAll: () =>
    invokePierCommand<TerminalStatusBarPrefs>({
      type: "terminalStatusBar.prefs.getAll",
    }),
  onChanged: (cb) => {
    const listener = (_event: unknown, prefs: TerminalStatusBarPrefs) => {
      cb(prefs);
    };
    ipcRenderer.on(PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED, listener);
    return () => {
      ipcRenderer.off(
        PIER_BROADCAST.TERMINAL_STATUS_BAR_PREFS_CHANGED,
        listener
      );
    };
  },
  resetItem: (itemId) =>
    invokePierCommand<TerminalStatusBarPrefs>({
      itemId,
      type: "terminalStatusBar.prefs.resetItem",
    }),
  setItemOverride: (itemId, override) =>
    invokePierCommand<TerminalStatusBarPrefs>({
      itemId,
      override,
      type: "terminalStatusBar.prefs.setItemOverride",
    }),
};
