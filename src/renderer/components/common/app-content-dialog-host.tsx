import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { cn } from "@pier/ui/utils.ts";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
  if (size === "xl") return "sm:max-w-5xl";
  if (size === "lg") return "sm:max-w-2xl";
  if (size === "sm") return "sm:max-w-sm";
  return "sm:max-w-md";
}

function isLayerOpen(
  layer: AppContentDialogLayer,
  liveStack: readonly AppContentDialogLayer[]
): boolean {
  return liveStack.some((entry) => entry.id === layer.id);
}

function ContentDialogLayerView({
  layer,
  isTopmost,
  open,
}: {
  layer: AppContentDialogLayer;
  isTopmost: boolean;
  open: boolean;
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
        updateAppContentDialog(layer.id, {
          description,
        });
      },
    }),
    [layer.id]
  );

  return (
    <div
      data-content-dialog-layer={layer.id}
      data-open={open ? "true" : "false"}
      data-testid={`content-dialog-layer-${layer.id}`}
    >
      <Dialog
        // Menu → content-dialog mounts with open=true while body is still locked.
        // If deferred open abandons, drop the stack layer so focus/scopes unlock.
        onAbandonOpen={() => {
          if (open) {
            closeAppContentDialog(layer.id, null);
          }
        }}
        onOpenChange={(nextOpen) => {
          // Closing animation: product close sets open=false first; Radix then
          // fires onOpenChange(false). Only mutate the store when still live.
          if (!nextOpen && open && layer.dismissible) {
            closeAppContentDialog(layer.id, null);
          }
        }}
        open={open}
      >
        <DialogContent
          className={cn(
            sizeClass(layer.size),
            !isTopmost && "pointer-events-none opacity-0"
          )}
          closeOnOverlayClick={layer.closeOnOverlayClick && layer.dismissible}
          initialFocus="firstFocusable"
          onEscapeKeyDown={(event) => {
            if (!(isTopmost && open)) {
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
    </div>
  );
}

/**
 * Host-owned content dialog stack renderer.
 * Mount next to AppDialogHost. Plugins open layers via the content dialog store.
 *
 * Closing keeps the previous top layer mounted with `open={false}` so Dialog's
 * exit animation can play (same retained-shell pattern as AppDialogHost).
 */
export function AppContentDialogHost() {
  const stack = useAppContentDialogStore((state) => state.stack);
  const topId = stack.at(-1)?.id ?? null;
  const [retainedStack, setRetainedStack] = useState<AppContentDialogLayer[]>(
    () => stack
  );

  useLayoutEffect(() => {
    setRetainedStack((previous) => {
      if (stack.length === 0) {
        // Keep the last presented stack so the final close can animate out.
        return previous;
      }
      const previousIds = new Set(previous.map((layer) => layer.id));
      const liveIds = new Set(stack.map((layer) => layer.id));
      const openedNewLayer = stack.some((layer) => !previousIds.has(layer.id));
      if (openedNewLayer) {
        // New open replaces any retained closed shells.
        return stack;
      }
      // Shrink / update: keep closed layers from the previous presentation so
      // intermediate tops can still play exit animation while lower layers remain.
      const closed = previous.filter((layer) => !liveIds.has(layer.id));
      return [...stack, ...closed];
    });
  }, [stack]);

  // Drop intermediate closed shells after Dialog exit animation budget.
  // Final empty-stack close keeps retainedShell until the next open.
  useEffect(() => {
    if (stack.length === 0) {
      return;
    }
    const liveIds = new Set(stack.map((layer) => layer.id));
    if (retainedStack.every((layer) => liveIds.has(layer.id))) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      setRetainedStack(stack);
    }, 150);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [stack, retainedStack]);

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

  const presentedStack = retainedStack.length > 0 ? retainedStack : stack;
  if (presentedStack.length === 0) return null;

  return (
    <>
      {presentedStack.map((layer, index) => {
        const open = isLayerOpen(layer, stack);
        return (
          <ContentDialogLayerView
            isTopmost={index === presentedStack.length - 1}
            key={layer.id}
            layer={layer}
            open={open}
          />
        );
      })}
    </>
  );
}
