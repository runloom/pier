import { useEffect, useRef } from "react";
import {
  listWindows,
  onWindowsChanged,
  reportDisplayDraft,
} from "@/lib/ipc/window-ipc.ts";
import { windowDisplayDraftFromDescriptors } from "@/lib/window-display-draft.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWindowListStore } from "@/stores/window-list.store.ts";

const DEBOUNCE_MS = 50;

/**
 * Report this window's identity draft to main for OS / menu titles.
 * OSC-only tab changes do not change the draft payload.
 */
export function WindowDisplayBridge(): null {
  const activeId = usePanelDescriptorStore((s) => s.activeId);
  const descriptors = usePanelDescriptorStore((s) => s.descriptors);
  const lastPayload = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    listWindows()
      .then((windows) => {
        if (!cancelled) {
          useWindowListStore.getState().apply(windows);
        }
      })
      .catch(() => undefined);
    const unsub = onWindowsChanged((windows) => {
      useWindowListStore.getState().apply(windows);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const patch = windowDisplayDraftFromDescriptors(activeId, descriptors);
      const serialized = JSON.stringify(patch);
      if (serialized === lastPayload.current) {
        return;
      }
      reportDisplayDraft(patch)
        .then(() => {
          lastPayload.current = serialized;
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeId, descriptors]);

  return null;
}
