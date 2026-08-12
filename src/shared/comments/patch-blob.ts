/**
 * 从 git unified patch（`--full-index`）解析 index 行的 blob OID。
 * 生产 patch 管线带 full-index；缩写 oid 或缺失 index 行时返回 null。
 * 放 shared：git 插件与宿主 renderer 共用，避免插件跨边界 import 宿主。
 */

const FULL_INDEX_LINE = /^index ([0-9a-f]{40})\.\.([0-9a-f]{40})(?:\s+\d+)?$/mu;

export interface PatchBlobOids {
  readonly newOid: string;
  readonly oldOid: string;
}

/** 解析 patch 中第一条 full-index 的 old/new blob；失败返回 null。 */
export function parsePatchBlobOids(patch: string): PatchBlobOids | null {
  if (patch.length === 0) {
    return null;
  }
  const match = FULL_INDEX_LINE.exec(patch);
  if (match === null) {
    return null;
  }
  const oldOid = match[1];
  const newOid = match[2];
  if (oldOid === undefined || newOid === undefined) {
    return null;
  }
  return { newOid, oldOid };
}

/** 按评论 side 取对应 blob（new 侧 = 工作区/索引版本，old 侧 = 父版本）。 */
export function parseBlobOidForSide(
  patch: string,
  side: "new" | "old"
): string | undefined {
  const oids = parsePatchBlobOids(patch);
  if (oids === null) {
    return;
  }
  return side === "new" ? oids.newOid : oids.oldOid;
}
