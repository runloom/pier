import { usePanelFind } from "@plugins/api/panel-find.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import type { FilesTranslate } from "../i18n.ts";

const DEFAULT_UNAVAILABLE =
  "Find isn't available in this view. Switch to the editor.";

export function useFindUnavailableToast(
  searchRequest: number | undefined,
  unavailable: boolean,
  notify: ((message: string) => void) | undefined,
  message: string
): void {
  const handled = useRef(searchRequest);
  useEffect(() => {
    if (handled.current === searchRequest) {
      return;
    }
    handled.current = searchRequest;
    if (unavailable && searchRequest) {
      notify?.(message);
    }
  }, [message, notify, searchRequest, unavailable]);
}

export function FilesFindUnavailableNotice({
  children,
  context,
  panelId,
  searchRequest,
  t,
}: {
  children: ReactNode;
  context?: RendererPluginContext | undefined;
  panelId?: string | undefined;
  searchRequest?: number | undefined;
  t?: FilesTranslate | undefined;
}): ReactNode {
  const message =
    t?.("filePanel.search.unavailable", DEFAULT_UNAVAILABLE) ??
    DEFAULT_UNAVAILABLE;
  const skipSearchRequest = useRef(false);
  const emit = useCallback(() => {
    context?.notifications.info(message);
  }, [context, message]);
  const onFind = useCallback(() => {
    skipSearchRequest.current = true;
    emit();
  }, [emit]);
  usePanelFind(panelId, onFind);
  const onChromeSearch = useCallback(() => {
    if (skipSearchRequest.current) {
      skipSearchRequest.current = false;
      return;
    }
    emit();
  }, [emit]);
  useFindUnavailableToast(searchRequest, true, onChromeSearch, message);
  return children;
}
