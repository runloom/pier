import { readFile } from "node:fs/promises";
import {
  PIER_MANAGED_PLUGIN_GENERATION,
  pierManagedPluginGeneration,
  writeManagedPluginFile,
} from "./managed-plugin-file.ts";

export interface ManagedPluginGroupFile {
  label: string;
  path: string;
  source: string;
}

interface ManagedPluginGroupSnapshot extends ManagedPluginGroupFile {
  content: string | null;
  generation: number | null;
}

async function snapshot(
  file: ManagedPluginGroupFile
): Promise<ManagedPluginGroupSnapshot> {
  const content = await readFile(file.path, "utf8").catch(() => null);
  return {
    ...file,
    content,
    generation: content === null ? null : pierManagedPluginGeneration(content),
  };
}

function isWritable(item: ManagedPluginGroupSnapshot): boolean {
  return (
    item.content === null ||
    (item.generation !== null &&
      item.generation <= PIER_MANAGED_PLUGIN_GENERATION)
  );
}

function isOwned(item: ManagedPluginGroupSnapshot): boolean {
  return (
    item.content !== null &&
    item.generation !== null &&
    item.generation <= PIER_MANAGED_PLUGIN_GENERATION
  );
}

/** 整组先验均可写才发布；发布后逐字复核。 */
export async function writeManagedPluginGroup(
  files: readonly ManagedPluginGroupFile[]
): Promise<boolean> {
  const before = await Promise.all(files.map(snapshot));
  if (!before.every(isWritable)) {
    return false;
  }
  const results = await Promise.all(files.map(writeManagedPluginFile));
  if (
    !results.every((result) => result === "written" || result === "unchanged")
  ) {
    return false;
  }
  const after = await Promise.all(files.map(snapshot));
  return after.every((item) => item.content === item.source);
}

/**
 * 全缺失或任一非托管/更新世代时返回 null；否则只返回可证明属于当前 Pier
 * 的文件，调用方据此逐文件删除并保留目录内未知内容。
 */
export async function ownedManagedPluginGroupPaths(
  files: readonly ManagedPluginGroupFile[]
): Promise<string[] | null> {
  const group = await Promise.all(files.map(snapshot));
  if (
    group.every((item) => item.content === null) ||
    !group.every((item) => item.content === null || isOwned(item))
  ) {
    return null;
  }
  return group.filter(isOwned).map((item) => item.path);
}
