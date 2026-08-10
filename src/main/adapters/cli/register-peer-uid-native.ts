/**
 * 将 Ghostty native 的 getUnixPeerUid（getpeereid）挂到 peer-identity 平台解析器。
 * 无 native / 无该 export 时 no-op，生产退回 fs-acl。
 */
import {
  createFdPeerUidResolver,
  registerUnixPeerUidResolver,
} from "./peer-identity.ts";

export function registerPeerUidFromNativeAddon(
  addon: { getUnixPeerUid?: (fd: number) => number | null } | null | undefined
): void {
  const peerUid = addon?.getUnixPeerUid;
  if (typeof peerUid !== "function") {
    return;
  }
  registerUnixPeerUidResolver(
    createFdPeerUidResolver((fd) => {
      const uid = peerUid(fd);
      return typeof uid === "number" && Number.isFinite(uid) ? uid : null;
    })
  );
}
