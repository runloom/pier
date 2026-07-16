import type { IpcMainInvokeEvent } from "electron";

/** 特权 renderer IPC 只接受当前 Pier webContents 的主 frame。 */
export function isTrustedMainFrame(
  event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">
): boolean {
  return (
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  );
}
