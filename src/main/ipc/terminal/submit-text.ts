import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import type { NativeAddon } from "./native-addon.ts";

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
  sendQueueByPanel.set(
    nativePanelId,
    result.then(
      () => undefined,
      () => undefined
    )
  );
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
}): Promise<TerminalOperationResult> {
  return enqueueTerminalSend(args.nativePanelId, async () => {
    let delivered = false;
    try {
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
  nativePanelId: string
): Promise<boolean> {
  return enqueueTerminalSend(nativePanelId, async () => {
    try {
      return addon.sendKeyPress(nativePanelId, APPKIT_KEYCODE.return, 0, "\r");
    } catch {
      return false;
    }
  });
}
