import type { Stats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** undefined 只表示确认不存在；权限/其它读取失败不能当空文件水位。 */
function missingFile(error: unknown): undefined | null {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
    ? undefined
    : null;
}

export function statTranscriptFile(
  path: string
): Promise<Stats | undefined | null> {
  return stat(path).catch(missingFile);
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !(rel.startsWith("..") || isAbsolute(rel));
}

async function resolveExistingAncestor(path: string, allowMissing: boolean) {
  let ancestor = path;
  for (;;) {
    const canonical = await realpath(ancestor).catch(missingFile);
    if (canonical) {
      return {
        path: resolve(canonical, relative(ancestor, path)),
        missing: ancestor !== path,
      };
    }
    const parent = dirname(ancestor);
    if (canonical === null || !allowMissing || parent === ancestor) return null;
    ancestor = parent;
  }
}

export interface ResolvedTranscriptPath {
  missing: boolean;
  path: string;
  root: string;
}

/** 晚创建路径只登记监听；首次读取前必须再次通过真实路径校验。 */
export async function resolveTranscriptPath(
  path: string,
  root: string,
  allowMissing = false
): Promise<ResolvedTranscriptPath | null> {
  const resolvedPath = resolve(path);
  if (!isWithin(root, resolvedPath)) return null;
  const [canonicalRoot, canonicalPath] = await Promise.all([
    resolveExistingAncestor(root, allowMissing),
    resolveExistingAncestor(resolvedPath, allowMissing),
  ]);
  if (!(canonicalRoot && canonicalPath)) return null;
  return isWithin(canonicalRoot.path, canonicalPath.path)
    ? { ...canonicalPath, root: canonicalRoot.path }
    : null;
}

/** 原路径只有仍指向这次同一文件时才复用；链接改指新文件须重新绑定。 */
export async function selectObservedTranscriptPath(
  resolved: ResolvedTranscriptPath,
  registeredPath: string | undefined
): Promise<string> {
  if (
    registeredPath &&
    (await resolveTranscriptPath(registeredPath, resolved.root))?.path ===
      resolved.path
  )
    return registeredPath;
  return resolved.path;
}
