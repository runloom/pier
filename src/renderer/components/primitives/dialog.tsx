import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { Button } from "@/components/primitives/button.tsx";
import { cn } from "@/utils/index.ts";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "app-no-drag data-open:fade-in-0 data-closed:fade-out-0 fixed top-[var(--app-titlebar-height)] right-0 bottom-0 left-0 isolate z-50 bg-overlay-scrim duration-100 data-closed:animate-out data-open:animate-in",
        className
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

// radix Select / Popover / DropdownMenu / Menu / Combobox 等 portal-rendered
// 弹层在 Dialog 内打开后, 用户点弹层外 (Dialog 内空白 / overlay) 想关弹层:
// 弹层自己的 dismissable layer 会关闭它, 但同一个 pointerdown 也会被 Dialog
// 的 dismissable layer 当 outside click → 顺带关 Dialog (bug)。
//
// 修法: capture-phase 监听 document.pointerdown, 那一刻若 DOM 中存在任何
// 打开的 inner-portal (SelectContent / PopoverContent 等), 记录时间戳。
// Dialog 的 outside handler 在同一 microtask fire, 检查时间窗 < 200ms 则
// preventDefault。覆盖三种点击场景 (Select item / Dialog 内空白 / overlay)
// 因为它们都发生在 Select 还打开的瞬间, query 都能命中。
const OPEN_INNER_PORTAL_SELECTOR = [
  "[data-slot=select-content]",
  "[data-slot=popover-content]",
  "[data-slot=dropdown-menu-content]",
  "[data-slot=context-menu-content]",
  "[data-slot=menubar-content]",
  "[data-slot=hover-card-content]",
  "[data-slot=combobox-content]",
  "[role=listbox]",
  "[role=menu]",
].join(",");

let lastClickWhileInnerPortalOpenAt = 0;

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      if (document.querySelector(OPEN_INNER_PORTAL_SELECTOR)) {
        lastClickWhileInnerPortalOpenAt = Date.now();
      }
    },
    true
  );
}

function isDialogOverlayClick(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.getAttribute("data-slot") === "dialog-overlay"
  );
}

function wasInnerPortalOpenRecently(): boolean {
  // 同一 microtask 时间差 < 50ms; 200ms 容差兼容慢机器 / electron。
  return Date.now() - lastClickWhileInnerPortalOpenAt < 200;
}

function DialogContent({
  className,
  children,
  closeOnOverlayClick = false,
  initialFocus = "content",
  overlayClassName,
  showCloseButton = true,
  onOpenAutoFocus,
  onPointerDownOutside,
  onInteractOutside,
  tabIndex = -1,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeOnOverlayClick?: boolean;
  initialFocus?: "content" | "firstFocusable";
  overlayClassName?: string;
  showCloseButton?: boolean;
}) {
  const overlay = <DialogOverlay className={overlayClassName} />;

  return (
    <DialogPortal>
      {closeOnOverlayClick ? (
        <DialogPrimitive.Close asChild>{overlay}</DialogPrimitive.Close>
      ) : (
        overlay
      )}
      <DialogPrimitive.Content
        className={cn(
          "app-no-drag data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 fixed top-[calc(var(--app-titlebar-height)+(100vh-var(--app-titlebar-height))/2)] left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[min(var(--radius-4xl),24px)] bg-popover p-6 text-popover-foreground text-sm shadow-xl outline-none duration-100 data-closed:animate-out data-open:animate-in sm:max-w-md",
          className
        )}
        data-slot="dialog-content"
        onFocusOutside={(e) => {
          // focus 跳到 Select / Popover 等 portal 时不该 close Dialog
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (wasInnerPortalOpenRecently()) {
            e.preventDefault();
            onInteractOutside?.(e);
            return;
          }
          if (!isDialogOverlayClick(e.target)) {
            e.preventDefault();
          }
          onInteractOutside?.(e);
        }}
        onOpenAutoFocus={(event) => {
          if (onOpenAutoFocus) {
            onOpenAutoFocus(event);
            return;
          }
          if (initialFocus === "firstFocusable") {
            return;
          }
          event.preventDefault();
          const target = event.currentTarget;
          if (target instanceof HTMLElement) {
            target.focus({ preventScroll: true });
          }
        }}
        onPointerDownOutside={(e) => {
          // 点击发生时 Select / Popover 等 inner-portal 在 DOM 中 = 用户想关
          // 那个弹层而非 Dialog → prevent
          if (wasInnerPortalOpenRecently()) {
            e.preventDefault();
            onPointerDownOutside?.(e);
            return;
          }
          if (!isDialogOverlayClick(e.target)) {
            e.preventDefault();
          }
          onPointerDownOutside?.(e);
        }}
        tabIndex={tabIndex}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild data-slot="dialog-close">
            <Button
              className="absolute top-4 right-4 bg-secondary"
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      data-slot="dialog-footer"
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-medium text-base leading-none", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-muted-foreground text-sm *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
