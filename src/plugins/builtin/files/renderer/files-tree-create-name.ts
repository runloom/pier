import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilesPendingCreateKind } from "./files-tree-registry.ts";

export function waitForFilesTreePaint(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  } else {
    queueMicrotask(() => resolve());
  }
  return promise;
}

export function joinFilesTreeRelativePath(
  parentDir: string,
  name: string
): string {
  return parentDir.length > 0 ? `${parentDir}/${name}` : name;
}

export function defaultFilesTreeBaseName(kind: FilesPendingCreateKind): string {
  return kind === "file" ? "untitled.ts" : "New Folder";
}

function kindLooksLikeFileBase(base: string): boolean {
  const dot = base.lastIndexOf(".");
  return dot > 0 && !base.includes("/");
}

function nextCandidateName(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }
  const dot = base.lastIndexOf(".");
  if (dot > 0 && kindLooksLikeFileBase(base)) {
    return `${base.slice(0, dot)} ${attempt}${base.slice(dot)}`;
  }
  return `${base} ${attempt}`;
}

export async function allocateUniqueChildName(
  root: string,
  parentDir: string,
  base: string,
  exists: RendererPluginContext["files"]["exists"]
): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const name = nextCandidateName(base, attempt);
    const path = joinFilesTreeRelativePath(parentDir, name);
    const result = await exists({ path, root });
    if (!result.exists) {
      return name;
    }
  }
  return nextCandidateName(base, Date.now());
}
