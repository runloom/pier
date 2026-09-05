import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useMemo, useSyncExternalStore } from "react";
import { EMPTY_CHANGES_SNAPSHOT, getFileChangesResource } from "./resource.ts";

const emptySubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY_CHANGES_SNAPSHOT;
export function useFileChanges(
  context: RendererPluginContext | undefined,
  documentId: string
) {
  const resource = useMemo(
    () =>
      context && documentId
        ? getFileChangesResource(context, documentId)
        : null,
    [context, documentId]
  );
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? emptySubscribe,
    resource?.getSnapshot ?? emptySnapshot
  );
  return { resource, snapshot };
}
