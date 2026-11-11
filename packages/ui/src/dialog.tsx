import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import type * as React from "react";
import { Button } from "./button.tsx";
import { isTopmostModalContent } from "./modal-layer.ts";
import { useDeferredDialogOpen } from "./use-deferred-dialog-open.ts";
import {
  useTerminalOverlay,
  useTerminalOverlayRegistration,
} from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

function Dialog({
  open,
  onAbandonOpen,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  /**
   * Called when a deferred open is abandoned because a menu/body lock never
   * cleared. Host content dialogs use this to pop the stack layer.
   */
  onAbandonOpen?: () => void;
}) {
  const deferredOpen = useDeferredDialogOpen(
    open,
    onAbandonOpen === undefined ? {} : { onAbandon: onAbandonOpen }
  );
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      {...props}
      {...(open === undefined || deferredOpen === undefined
        ? {}
        : { open: deferredOpen })}
    />
  );
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

/**
 * 蒙层视觉铺满窗口，命中拆开：
 * - 蒙层本身 `pointer-events-none`，避免盖住 macOS 红绿灯
 * - 工作区 catcher 接收点击
 * - 标题栏 catcher 避开红绿灯；可点关的弹窗是 `no-drag`（否则 Electron
 *   `app-drag` 会在原生层吞掉 click），其余弹窗保留 `app-drag` 拖窗口
 */
function OverlayScrimCatchers({
  allowTitlebarDismiss = false,
}: {
  allowTitlebarDismiss?: boolean;
}) {
  return (
    <>
      <div
        className="pointer-events-auto absolute inset-x-0 top-[var(--app-titlebar-height)] bottom-0"
        data-slot="overlay-scrim-catcher"
      />
      <div
        className={cn(
          "pointer-events-auto absolute top-0 right-0 left-[max(5.5rem,env(safe-area-inset-left,0px))] h-[var(--app-titlebar-height)]",
          allowTitlebarDismiss ? "app-no-drag" : "app-drag"
        )}
        data-slot="overlay-scrim-catcher"
        data-titlebar=""
      />
    </>
  );
}

function DialogOverlay({
  allowTitlebarDismiss = false,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & {
  allowTitlebarDismiss?: boolean;
}) {
  // 遮罩是半透明 scrim：不回填洞（整窗回填会把终端换成不透明 backing），
  // 把 computed background 交给 native，在洞里画同色。卡片单独回填。
  const overlayRef = useTerminalOverlay({ paints: false, scrim: true });
  const composedRef = useComposedRefs(props.ref, overlayRef);
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "app-no-drag pointer-events-none fixed inset-0 isolate z-50 bg-overlay-scrim data-closed:animate-[pier-overlay-fade-out_100ms_ease-out] data-open:animate-[pier-overlay-fade-in_100ms_ease-out]",
        className
      )}
      data-slot="dialog-overlay"
      {...props}
      ref={composedRef}
    >
      <OverlayScrimCatchers allowTitlebarDismiss={allowTitlebarDismiss} />
      {children}
    </DialogPrimitive.Overlay>
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
  if (!(target instanceof Element)) {
    return false;
  }
  const slot = target.getAttribute("data-slot");
  return slot === "dialog-overlay" || slot === "overlay-scrim-catcher";
}

function wasInnerPortalOpenRecently(): boolean {
  // 同一 microtask 时间差 < 50ms; 200ms 容差兼容慢机器 / electron。
  return Date.now() - lastClickWhileInnerPortalOpenAt < 200;
}

type DialogContentProps = React.ComponentProps<
  typeof DialogPrimitive.Content
> & {
  closeOnOverlayClick?: boolean;
  initialFocus?: "content" | "firstFocusable";
  overlayClassName?: string;
} & (
    | { closeLabel: string; showCloseButton: true }
    | { closeLabel?: never; showCloseButton?: false }
  );

function DialogContent({
  className,
  children,
  closeLabel,
  closeOnOverlayClick = false,
  initialFocus = "content",
  overlayClassName,
  showCloseButton = false,
  onOpenAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  tabIndex = -1,
  ...props
}: DialogContentProps) {
  const overlay = (
    <DialogOverlay
      allowTitlebarDismiss={closeOnOverlayClick}
      className={overlayClassName}
    />
  );
  // 卡片是不透明 web 面，必须登记回填：遮罩已改为 paints:false，
  // 卡片区域若仍留洞，native 终端会盖住 Dialog 内容。
  const contentOverlay = useTerminalOverlayRegistration();
  const contentRef = useComposedRefs(props.ref, contentOverlay.ref);

  return (
    <DialogPortal>
      {closeOnOverlayClick ? (
        <DialogPrimitive.Close asChild>{overlay}</DialogPrimitive.Close>
      ) : (
        overlay
      )}
      <DialogPrimitive.Content
        className={cn(
          // 壳几何必须全程静止：洞回填是快照管道（IPC 往返），追不上逐帧
          // 动画。淡入只动 opacity（pier-overlay-fade-*）。tw-animate 的
          // enter 会在整段过渡写全零 blur / 三维位移（gpu-compositing 治理
          // 禁的正是这两个标记），filter 破坏洞合成，底部状态栏也会和洞里
          // 的蒙层错拍。
          // top 是标题栏下沿、bottom 贴窗口底，h-fit + m-auto 把盒子居中。
          // top 写成中线会让上边缘落在中线，弹窗下移半高。
          "app-no-drag fixed inset-x-0 top-[var(--app-titlebar-height)] bottom-0 z-50 m-auto grid h-fit w-full max-w-[calc(100%-2rem)] gap-6 rounded-[min(var(--radius-4xl),24px)] bg-popover p-6 text-popover-foreground text-sm shadow-xl outline-none data-closed:animate-[pier-overlay-fade-out_100ms_ease-out] data-open:animate-[pier-overlay-fade-in_100ms_ease-out] sm:max-w-md",
          className
        )}
        data-slot="dialog-content"
        onEscapeKeyDown={(event) => {
          // Host multi-layer content dialogs: only the topmost shell dismisses.
          if (!isTopmostModalContent(event.currentTarget)) {
            event.preventDefault();
            return;
          }
          onEscapeKeyDown?.(event);
        }}
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
        ref={contentRef}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild data-slot="dialog-close">
            <Button
              className="absolute top-4 right-4"
              size="icon-sm"
              variant="secondary"
            >
              <XIcon data-icon="inline-start" />
              <span className="sr-only">{closeLabel}</span>
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
  children,
  ...props
}: React.ComponentProps<"div">) {
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
  OverlayScrimCatchers,
};
