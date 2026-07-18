"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import type * as React from "react";
import { Button } from "./button.tsx";
import { isTopmostModalContent } from "./modal-layer.ts";
import { useDeferredDialogOpen } from "./use-deferred-dialog-open.ts";
import { useTerminalOverlayRegistration } from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

function AlertDialog({
  open,
  onAbandonOpen,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root> & {
  /**
   * Called when a deferred open is abandoned because a menu/body lock never
   * cleared. Host shells may use this to drop staged modal state.
   */
  onAbandonOpen?: () => void;
}) {
  const deferredOpen = useDeferredDialogOpen(
    open,
    onAbandonOpen === undefined ? {} : { onAbandon: onAbandonOpen }
  );
  return (
    <AlertDialogPrimitive.Root
      data-slot="alert-dialog"
      {...props}
      {...(deferredOpen === undefined ? {} : { open: deferredOpen })}
    />
  );
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
}

function AlertDialogOverlay({
  className,
  terminalOverlayId,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay> & {
  terminalOverlayId?: string;
}) {
  const overlay = useTerminalOverlayRegistration(terminalOverlayId);
  const composedRef = useComposedRefs(props.ref, overlay.ref);
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "app-no-drag data-open:fade-in-0 data-closed:fade-out-0 fixed top-[var(--app-titlebar-height)] right-0 bottom-0 left-0 z-50 bg-overlay-scrim duration-100 data-closed:animate-out data-open:animate-in",
        className
      )}
      data-slot="alert-dialog-overlay"
      {...props}
      ref={composedRef}
    />
  );
}

function AlertDialogContent({
  className,
  size = "default",
  terminalOverlayId,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm";
  terminalOverlayId?: string;
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay
        {...(terminalOverlayId ? { terminalOverlayId } : {})}
      />
      <AlertDialogPrimitive.Content
        className={cn(
          "app-no-drag group/alert-dialog-content data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 pointer-events-auto fixed top-[calc(var(--app-titlebar-height)+(100vh-var(--app-titlebar-height))/2)] left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-5 text-popover-foreground shadow-xl outline-none ring-1 ring-foreground/5 duration-100 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-closed:animate-out data-open:animate-in data-[size=default]:sm:max-w-md dark:ring-foreground/10",
          className
        )}
        data-size={size}
        data-slot="alert-dialog-content"
        onEscapeKeyDown={(event) => {
          if (!isTopmostModalContent(event.currentTarget)) {
            event.preventDefault();
            return;
          }
          onEscapeKeyDown?.(event);
        }}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // 左齐工具对话框。icon+title 对齐由 host 的 flex 行负责；这里只管基础堆叠。
        "grid gap-1.5 text-left has-data-[slot=alert-dialog-media]:grid-cols-[auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-3 has-data-[slot=alert-dialog-media]:*:[data-slot=alert-dialog-media]:row-span-2",
        className
      )}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  singleAction = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** One primary button only (alert). Still end-clustered on desktop. */
  singleAction?: boolean;
}) {
  return (
    <div
      className={cn(
        // 右簇按钮；取消 sm 两列等宽 grid（那是移动确认卡，不是桌面 IDE）。
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        singleAction ? "sm:justify-end" : null,
        className
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // 可选侧标，不是 64px 营销大圆。host 默认不用；保留 API 给特殊场景。
        "row-span-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground *:[svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="alert-dialog-media"
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn(
        "text-balance font-medium text-base leading-snug group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn(
        "text-pretty text-muted-foreground text-sm leading-relaxed group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button asChild size={size} variant={variant}>
      <AlertDialogPrimitive.Action
        className={cn(className)}
        data-slot="alert-dialog-action"
        {...props}
      />
    </Button>
  );
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button asChild size={size} variant={variant}>
      <AlertDialogPrimitive.Cancel
        className={cn(className)}
        data-slot="alert-dialog-cancel"
        {...props}
      />
    </Button>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
