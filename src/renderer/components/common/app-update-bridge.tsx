import { useEffect } from "react";
import { initAppUpdateBridge } from "@/stores/app-update.store.ts";

/** Host bridge: mirrors app-update snapshot; no UI. */
export function AppUpdateBridge(): null {
  useEffect(() => {
    const { dispose } = initAppUpdateBridge();
    return dispose;
  }, []);
  return null;
}
