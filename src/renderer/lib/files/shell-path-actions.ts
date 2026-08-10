/**
 * Host settings / agent-assets UI should open and reveal disk paths through
 * `window.pier.files` and the files panel (same shell + editor path as the
 * files plugin), not parallel `agentAssets.*.reveal/open` helpers.
 */

import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { openFilesDiskPath } from "./open-disk-file-panel.ts";

export type ShellPathActionResult =
  | { ok: true }
  | { ok: false; reason: string };

function lastPathSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** Split an absolute file/dir path for `files.reveal({ root, path })`. */
export function splitAbsoluteForReveal(absolutePath: string): {
  path: string;
  root: string;
} {
  const trimmed = absolutePath.trim();
  const sep = lastPathSeparatorIndex(trimmed);
  if (sep <= 0) {
    throw new Error(`Cannot reveal path without a parent: ${absolutePath}`);
  }
  const leaf = trimmed.slice(sep + 1);
  if (!leaf) {
    throw new Error(`Cannot reveal path without a basename: ${absolutePath}`);
  }
  return {
    path: leaf,
    root: trimmed.slice(0, sep),
  };
}

export function joinUnderRoot(root: string, relativePath: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, "");
  const cleanRel = relativePath.replace(/^[\\/]+/, "");
  if (!cleanRel) {
    return cleanRoot;
  }
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${cleanRoot}${sep}${cleanRel}`;
}

export async function revealAbsolutePath(
  absolutePath: string
): Promise<ShellPathActionResult> {
  try {
    const { path, root } = splitAbsoluteForReveal(absolutePath);
    await window.pier.files.reveal({ path, root });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Open with the OS default app (`shell.openPath`). Not the Pier editor —
 * use `openAbsoluteInPierEditor` for product file viewing/editing.
 */
export async function openAbsolutePath(
  absolutePath: string
): Promise<ShellPathActionResult> {
  try {
    const result = await window.pier.files.openPath({ path: absolutePath });
    if (!result.opened) {
      return { ok: false, reason: result.reason };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Open an absolute disk path in the files editor panel and close Settings. */
export function openAbsoluteInPierEditor(
  absolutePath: string,
  title?: string
): ShellPathActionResult {
  try {
    const { path, root } = splitAbsoluteForReveal(absolutePath);
    const opened = openFilesDiskPath({
      path,
      root,
      ...(title ? { title } : {}),
    });
    if (!opened) {
      return {
        ok: false,
        reason: "Files panel is unavailable for this path",
      };
    }
    useSettingsDialogStore.getState().close();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function revealUnderRoot(
  root: string,
  relativePath: string
): Promise<ShellPathActionResult> {
  try {
    await window.pier.files.reveal({ path: relativePath, root });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function openUnderRoot(
  root: string,
  relativePath: string
): Promise<ShellPathActionResult> {
  return openAbsolutePath(joinUnderRoot(root, relativePath));
}

/** Open a root-relative path in the files editor panel and close Settings. */
export function openUnderRootInPierEditor(
  root: string,
  relativePath: string,
  title?: string
): ShellPathActionResult {
  const opened = openFilesDiskPath({
    path: relativePath,
    root,
    ...(title ? { title } : {}),
  });
  if (!opened) {
    return {
      ok: false,
      reason: "Files panel is unavailable for this path",
    };
  }
  useSettingsDialogStore.getState().close();
  return { ok: true };
}
