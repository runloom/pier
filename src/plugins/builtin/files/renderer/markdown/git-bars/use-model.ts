import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { GitDiffFilePatch, GitDiffPatch } from "@shared/contracts/git.ts";
import { useEffect, useState } from "react";
import {
  buildGitGutterModel,
  EMPTY_GIT_GUTTER_MODEL,
  type GitGutterModel,
} from "../../editor/git-markers.ts";
import type { MarkdownDiskSource } from "../resource-elements.tsx";

const REFRESH_DEBOUNCE_MS = 200;

export function filePatchForPath(
  patch: GitDiffPatch,
  path: string
): GitDiffFilePatch | null {
  return (
    patch.files.find((file) => file.path === path) ??
    patch.files.find((file) => file.oldPath === path) ??
    null
  );
}

/**
 * Disk-vs-HEAD git markers for a markdown preview. Path-scoped fetch; failures
 * silently clear (same as the source gutter). `refreshKey` is the files
 * document disk revision so a save refetches without waiting for `git.watch`.
 */
export function useMarkdownPreviewGitModel(input: {
  readonly context: RendererPluginContext | undefined;
  readonly refreshKey?: string | null | undefined;
  readonly source: MarkdownDiskSource | undefined;
}): GitGutterModel {
  const [model, setModel] = useState<GitGutterModel>(EMPTY_GIT_GUTTER_MODEL);
  const gitApi = input.context?.git;
  const path = input.source?.path;
  const root = input.source?.root;
  const refreshKey = input.refreshKey ?? "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: path/root are identity keys; the body only drops stale bars.
  useEffect(() => {
    setModel(EMPTY_GIT_GUTTER_MODEL);
  }, [path, root]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey retriggers fetch after save; keep painted bars until it returns.
  useEffect(() => {
    if (!(gitApi?.getDiffPatch && path && root)) {
      setModel(EMPTY_GIT_GUTTER_MODEL);
      return;
    }
    let cancelled = false;
    let generation = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      generation += 1;
      const current = generation;
      try {
        const patch = await gitApi.getDiffPatch(root, {
          from: "HEAD",
          path,
        });
        if (cancelled || current !== generation) {
          return;
        }
        setModel(buildGitGutterModel(filePatchForPath(patch, path)));
      } catch {
        if (!cancelled && current === generation) {
          setModel(EMPTY_GIT_GUTTER_MODEL);
        }
      }
    };
    const scheduleLoad = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        load().catch(() => undefined);
      }, REFRESH_DEBOUNCE_MS);
    };
    load().catch(() => undefined);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = gitApi.watch?.(root, scheduleLoad, () => undefined);
    } catch {
      unsubscribe = undefined;
    }
    return () => {
      cancelled = true;
      clearTimeout(refreshTimer);
      try {
        unsubscribe?.();
      } catch {
        // Watch start can throw; teardown must still run.
      }
    };
  }, [gitApi, path, refreshKey, root]);

  return model;
}
