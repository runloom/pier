import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";

// identity key 只表达文件文档身份；dockview 标签实例还要追加 nonce。
// 同一 disk source 在不同 group 可以拥有多个 tab instance,但仍共享同一
// document store key。hash 参数取自 files-document-store 的 diskDocumentId,
// 保持 document lookup 与 panel source 同源判断一致。

export function fileFilePanelIdentityKey(
  source: FilesDocumentPanelSource
): string {
  if (source.kind === "untitled") {
    return `${FILES_FILE_PANEL_ID}:untitled:${source.id}`;
  }
  return `${FILES_FILE_PANEL_ID}:disk:${stableFileIdentityHash(
    `${source.root}\u0000${source.path}`
  )}`;
}

function createFilePanelNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return stableFileIdentityHash(`${Date.now()}\u0000${Math.random()}`);
}

export function createFileFilePanelInstanceId(
  source: FilesDocumentPanelSource,
  nonce = createFilePanelNonce()
): string {
  return `${fileFilePanelIdentityKey(source)}:${nonce}`;
}
