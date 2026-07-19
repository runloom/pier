import { stableFileIdentityHash } from "./files-stable-hash.ts";

export function diskDocumentId(root: string, path: string): string {
  return `pier.files.file:${stableFileIdentityHash(`${root}\0${path}`)}`;
}

/** Join disk panel source root+path into a comparable absolute path identity. */
export function absoluteDiskSourcePath(root: string, path: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  const normalizedPath = path
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!normalizedPath) {
    return normalizedRoot;
  }
  if (normalizedRoot === "/") {
    return `/${normalizedPath}`;
  }
  return `${normalizedRoot}/${normalizedPath}`;
}

export function isSamePathOrDescendant(
  entryPath: string,
  path: string
): boolean {
  return entryPath === path || entryPath.startsWith(`${path}/`);
}

export function rewriteDescendantPath(
  entryPath: string,
  oldPath: string,
  newPath: string
): string {
  if (entryPath === oldPath) {
    return newPath;
  }
  return `${newPath}/${entryPath.slice(oldPath.length + 1)}`;
}
