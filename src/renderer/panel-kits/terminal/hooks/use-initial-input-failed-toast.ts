import { useEffect } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";

export function useInitialInputFailedToast(panelId: string): void {
  const t = useT();
  useEffect(() => {
    const unsubscribe = window.pier.terminal.onInitialInputFailed((event) => {
      if (event.panelId !== panelId) {
        return;
      }
      let key = "terminal.initialInput.setupFailed";
      if (event.kind === "prompt") {
        key = event.textDelivered
          ? "terminal.initialInput.promptEnterFailed"
          : "terminal.initialInput.promptFailed";
      } else if (event.kind === "task") {
        key = event.textDelivered
          ? "terminal.initialInput.taskEnterFailed"
          : "terminal.initialInput.taskFailed";
      } else if (event.textDelivered) {
        key = "terminal.initialInput.setupEnterFailed";
      }
      toast.error(t(key));
    });
    return unsubscribe;
  }, [panelId, t]);
}
