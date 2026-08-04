/**
 * remote-tracking 短名 → 本地分支名。
 * `origin/feature/x` → `feature/x`；无 `/` 时返回 null。
 */
export function localNameFromRemoteTracking(remoteRef: string): null | string {
  const slash = remoteRef.indexOf("/");
  if (slash <= 0 || slash >= remoteRef.length - 1) {
    return null;
  }
  return remoteRef.slice(slash + 1);
}
