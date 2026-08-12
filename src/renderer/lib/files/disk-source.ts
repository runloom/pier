/**
 * Files disk panel source 解析 — 宿主 open 路径与 tab 消歧共用，禁止再抄一份。
 * root/path 规范化与 files absoluteDiskSourcePath 同规则（\\ → /、去首尾多余 /）。
 */

export interface FilesDiskSource {
  kind: "disk";
  path: string;
  root: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 工作区根：统一 / 分隔，去掉尾部 /（根 `/` 保留）。 */
export function normalizeFilesDiskRoot(root: string): string {
  return root.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
}

/** 相对 path：统一 / 分隔，去掉首尾 /。 */
export function normalizeFilesDiskPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export function isFilesDiskSource(value: unknown): value is FilesDiskSource {
  if (!isRecord(value) || value.kind !== "disk") {
    return false;
  }
  return (
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.root === "string" &&
    value.root.length > 0
  );
}

/** 从 panel params 解析 disk source；非 disk / 畸形返回 null（path/root 已规范化）。 */
export function parseFilesDiskSourceFromParams(
  params: unknown
): FilesDiskSource | null {
  if (!(isRecord(params) && "source" in params)) {
    return null;
  }
  if (!isFilesDiskSource(params.source)) {
    return null;
  }
  const path = normalizeFilesDiskPath(params.source.path);
  const root = normalizeFilesDiskRoot(params.source.root);
  if (path.length === 0 || root.length === 0) {
    return null;
  }
  return { kind: "disk", path, root };
}

export function sameFilesDiskSource(
  left: { path: string; root: string },
  right: { path: string; root: string }
): boolean {
  return (
    normalizeFilesDiskRoot(left.root) === normalizeFilesDiskRoot(right.root) &&
    normalizeFilesDiskPath(left.path) === normalizeFilesDiskPath(right.path)
  );
}
