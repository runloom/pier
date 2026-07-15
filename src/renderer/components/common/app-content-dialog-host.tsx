import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { cn } from "@pier/ui/utils.ts";
import { useEffect, useMemo } from "react";
import {
  type AppContentDialogLayer,
  type AppContentDialogRenderProps,
  closeAppContentDialog,
  updateAppContentDialog,
  useAppContentDialogStore,
} from "@/stores/app-content-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

const CONTENT_DIALOG_OVERLAY_ID = "app-content-dialog";

function sizeClass(size: AppContentDialogLayer["size"]): string {
  if (size === "lg") return "sm:max-w-2xl";
  if (size === "sm") return "sm:max-w-sm";
  return "sm:max-w-md";
}

function ContentDialogLayerView({
  layer,
  isTopmost,
}: {
  layer: AppContentDialogLayer;
  isTopmost: boolean;
}) {
  const Content = layer.content;

  const renderProps = useMemo<AppContentDialogRenderProps>(
    () => ({
      id: layer.id,
      close: (result) => {
        closeAppContentDialog(layer.id, result ?? null);
      },
      setDismissible: (dismissible) => {
        updateAppContentDialog(layer.id, { dismissible });
      },
      setTitle: (title) => {
        updateAppContentDialog(layer.id, { title });
      },
      setDescription: (description) => {
        updateAppContentDialog(
          layer.id,
          description === undefined ? {} : { description }
        );
      },
    }),
    [layer.id]
  );

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && layer.dismissible) {
          closeAppContentDialog(layer.id, null);
        }
      }}
      open={true}
    >
      <DialogContent
        className={cn(
          sizeClass(layer.size),
          !isTopmost && "pointer-events-none opacity-0"
        )}
        closeOnOverlayClick={layer.closeOnOverlayClick && layer.dismissible}
        initialFocus="firstFocusable"
        onEscapeKeyDown={(event) => {
          if (!isTopmost) {
            event.preventDefault();
            return;
          }
          if (!layer.dismissible) {
            event.preventDefault();
            return;
          }
          closeAppContentDialog(layer.id, null);
        }}
        showCloseButton={false}
        {...(isTopmost
          ? {}
          : {
              "aria-hidden": true,
            })}
      >
        <DialogHeader>
          <DialogTitle>{layer.title}</DialogTitle>
          {layer.description ? (
            <DialogDescription>{layer.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <Content {...renderProps} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Host-owned content dialog stack renderer.
 * Mount next to AppDialogHost. Plugins open layers via the content dialog store.
 */
export function AppContentDialogHost() {
  const stack = useAppContentDialogStore((state) => state.stack);
  const topId = stack.at(-1)?.id ?? null;

  useEffect(() => {
    if (!topId) return;
    const releaseWebFocus = requestTerminalWebFocus(CONTENT_DIALOG_OVERLAY_ID);
    const scopeId = `overlay:${CONTENT_DIALOG_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
    };
  }, [topId]);
  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((layer, index) => (
        <ContentDialogLayerView
          isTopmost={index === stack.length - 1}
          key={layer.id}
          layer={layer}
        />
      ))}
    </>
  );
}
