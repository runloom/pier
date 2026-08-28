import { HTML_PREVIEW_SCHEME } from "@shared/contracts/file/html-preview-url.ts";
import { FILE_PREVIEW_SCHEME } from "@shared/file-preview-url.ts";
import type { Session } from "electron";
import { session as electronSession } from "electron";
import { authorizeHtmlPreviewRequest } from "./html-preview-protocol.ts";
import { htmlPreviewPartitionKey } from "./html-preview-ticket-registry.ts";
import { authorizeFilePreviewRequest } from "./preview-protocol.ts";
import { filePreviewPartitionKey } from "./preview-ticket-registry.ts";

type PreviewGuardSession = Pick<Session, "webRequest"> & {
  storagePath?: string | null;
};

/**
 * Electron 只保留每个 webRequest 事件的最后一个 listener。
 * 文件预览与 HTML 预览必须挂在同一条 onBeforeRequest 上。
 */
export function registerPreviewRequestGuards(
  targetSession: PreviewGuardSession = electronSession.defaultSession
): void {
  const filePartition = filePreviewPartitionKey(targetSession);
  const htmlPartition = htmlPreviewPartitionKey(targetSession);
  targetSession.webRequest.onBeforeRequest(
    {
      urls: [
        `${FILE_PREVIEW_SCHEME}://file/*`,
        `${HTML_PREVIEW_SCHEME}://preview/*`,
      ],
    },
    (details, callback) => {
      const allowed = details.url.startsWith(`${HTML_PREVIEW_SCHEME}:`)
        ? authorizeHtmlPreviewRequest(details, htmlPartition)
        : authorizeFilePreviewRequest(details, filePartition);
      callback({ cancel: !allowed });
    }
  );
}
