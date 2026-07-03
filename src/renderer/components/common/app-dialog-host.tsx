import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pier/ui/alert-dialog.tsx";
import { useEffect } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useAppDialogStore } from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal.store.ts";

const APP_DIALOG_OVERLAY_ID = "app-dialog";

export function AppDialogHost() {
  const t = useT();
  const dialog = useAppDialogStore((state) => state.current);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay(APP_DIALOG_OVERLAY_ID);
    const releaseWebFocus = requestTerminalWebFocus(APP_DIALOG_OVERLAY_ID);
    const scopeId = `overlay:${APP_DIALOG_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
  }, [dialog]);

  if (!dialog) {
    return null;
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          dialog.resolve(false);
        }
      }}
      open
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
          {dialog.body ? (
            <AlertDialogDescription className="whitespace-pre-wrap">
              {dialog.body}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {dialog.kind === "confirm" ? (
            <AlertDialogCancel onClick={() => dialog.resolve(false)}>
              {dialog.cancelLabel ?? t("dialog.cancel")}
            </AlertDialogCancel>
          ) : null}
          <AlertDialogAction onClick={() => dialog.resolve(true)}>
            {dialog.confirmLabel ?? t("dialog.ok")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
