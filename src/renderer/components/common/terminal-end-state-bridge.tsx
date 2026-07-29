import type { TerminalEndState } from "@shared/contracts/terminal-end-state.ts";
import { useEffect } from "react";
import { useTerminalEndStateStore } from "@/stores/terminal-end-state.store.ts";

/**
 * main TERMINAL_END_STATE_CHANGED → renderer EndState store。
 * 挂在 App 根；与 FA bridge 同级。
 */
export function TerminalEndStateBridge(): null {
  const upsertEnd = useTerminalEndStateStore((s) => s.upsertEnd);

  useEffect(() => {
    const api = window.pier?.terminal;
    if (!api?.onEndStateChanged) {
      return;
    }
    return api.onEndStateChanged((end: TerminalEndState) => {
      upsertEnd(end);
    });
  }, [upsertEnd]);

  return null;
}
