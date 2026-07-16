import type { PierFileTreeApi } from "@pier/ui/file-tree.tsx";
import { useFileTreeSearch } from "@pier/ui/use-file-tree-search.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type RefObject, useEffect, useState } from "react";
import { loadFilesTreeForSearch } from "./files-tree-search-loader.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";

interface UseFilesTreeSearchOptions {
  context: RendererPluginContext;
  fallbackError: string;
  list: FilesTreeList;
  root: string;
  searchFailedTitle: string;
  treeApiRef: RefObject<PierFileTreeApi | null>;
}

function searchFailureBody(
  path: string,
  error: unknown,
  fallback: string
): string {
  let detail = fallback;
  if (error instanceof Error && error.message.length > 0) {
    detail = error.message;
  } else if (typeof error === "string" && error.length > 0) {
    detail = error;
  }
  return path.length > 0 ? path.concat(": ", detail) : detail;
}

export function useFilesTreeSearch({
  context,
  fallbackError,
  list,
  root,
  searchFailedTitle,
  treeApiRef,
}: UseFilesTreeSearchOptions) {
  const search = useFileTreeSearch({ treeApiRef });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!(search.open && search.value.trim().length > 0)) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    loadFilesTreeForSearch(root, list, fallbackError)
      .then(async ({ failures }) => {
        if (!active) {
          return;
        }
        setLoading(false);
        const failure = failures[0];
        if (failure) {
          await context.dialogs.alert({
            body: searchFailureBody(failure.path, failure.error, fallbackError),
            size: "default",
            title: searchFailedTitle,
          });
        }
      })
      .catch(async (error: unknown) => {
        if (!active) {
          return;
        }
        setLoading(false);
        await context.dialogs.alert({
          body: searchFailureBody("", error, fallbackError),
          size: "default",
          title: searchFailedTitle,
        });
      });
    return () => {
      active = false;
    };
  }, [
    context,
    fallbackError,
    list,
    root,
    search.open,
    search.value,
    searchFailedTitle,
  ]);

  return { ...search, loading };
}
