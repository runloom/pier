/**
 * Whole-tree search loading was removed in path-query work (Task 7).
 * Tree search now uses `createFilesPathQueryClient` + ancestor-only
 * `loadFilesTreeDirectory` for reveal. This module remains only so
 * historical imports fail loudly if reintroduced.
 */

export type FilesTreeSearchLoadFailure = never;
export type FilesTreeSearchLoadResult = never;

export function loadFilesTreeForSearch(
  _root: string,
  _list: unknown,
  _fallbackError: string
): Promise<never> {
  return Promise.reject(
    new Error(
      "loadFilesTreeForSearch was removed; use createFilesPathQueryClient"
    )
  );
}
