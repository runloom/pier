import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import type { NativeAddon } from "./native-addon.ts";
import { nativeTerminalProcesses } from "./process/registry.ts";

/**
 * paste 与合成 Return 之间的 settle。两次写入若落在同一次 stdin read，
 * bracketed paste 会把 `\r` 吞掉（codex#28167；composer / 首条输入 / runtime-control 共用）。
 */
export const SUBMIT_ENTER_SETTLE_MS = 100;

const sendQueueByPanel = new Map<string, Promise<unknown>>();

export function enqueueTerminalSend<T>(
  nativePanelId: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = sendQueueByPanel.get(nativePanelId) ?? Promise.resolve();
  const result = previous.then(task);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  sendQueueByPanel.set(nativePanelId, tail);
  tail.then(() => {
    if (sendQueueByPanel.get(nativePanelId) === tail) {
      sendQueueByPanel.delete(nativePanelId);
    }
  });
  return result;
}

/**
 * 唯一「粘贴并可提交」入口。`sendText` 只承载正文；提交必须另打 Return。
 * `text` 为空且 `submit: true` 时只打回车。`text` 为空且不提交则失败。
 */
export async function pasteTerminalText(args: {
  addon: NativeAddon;
  nativePanelId: string;
  submit: boolean;
  text: string;
  /** Captured at request time, checked again at each actual write. */
  isCurrent?: (() => boolean) | undefined;
}): Promise<TerminalOperationResult> {
  const isCurrent =
    args.isCurrent ?? nativeTerminalProcesses.inputGuard(args.nativePanelId);
  return enqueueTerminalSend(args.nativePanelId, async () => {
    let delivered = false;
    try {
      if (!isCurrent()) {
        return { ok: false, error: "terminal process changed or ended" };
      }
      if (args.text.length > 0) {
        const textOk = args.addon.sendText(args.nativePanelId, args.text);
        if (!textOk) {
          return { ok: false, error: "terminal surface not ready" };
        }
        delivered = true;
      } else if (!args.submit) {
        return { ok: false, error: "invalid send text args" };
      }
      if (!args.submit) {
        return { ok: true };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, SUBMIT_ENTER_SETTLE_MS);
      });
      if (!isCurrent()) {
        return {
          ok: false,
          error: "terminal process changed or ended",
          textDelivered: delivered,
        };
      }
      const enterOk = args.addon.sendKeyPress(
        args.nativePanelId,
        APPKIT_KEYCODE.return,
        0,
        "\r"
      );
      return enterOk
        ? { ok: true }
        : {
            ok: false,
            error: "terminal surface not ready",
            textDelivered: delivered,
          };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ...(delivered ? { textDelivered: true } : {}),
      };
    }
  });
}

/** 只打合成 Return。粘贴已成功、回车失败时的重试入口，不再 paste 一遍。 */
export async function sendTerminalSubmitReturn(
  addon: NativeAddon,
  nativePanelId: string,
  isCurrent?: () => boolean
): Promise<boolean> {
  const guard = isCurrent ?? nativeTerminalProcesses.inputGuard(nativePanelId);
  return enqueueTerminalSend(nativePanelId, async () => {
    try {
      if (!guard()) {
        return false;
      }
      return addon.sendKeyPress(nativePanelId, APPKIT_KEYCODE.return, 0, "\r");
    } catch {
      return false;
    }
  });
}
