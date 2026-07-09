import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import * as React from "react";

import { useTerminalOverlay } from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

type DismissListener = () => void;

const dismissListeners = new Set<DismissListener>();
let hardSuppressCount = 0;
let softSuppressed = false;
let pointerMoveReleaseArmed = false;
let globalListenersInstalled = false;

function isTooltipSuppressed(): boolean {
  return hardSuppressCount > 0 || softSuppressed;
}

function notifyDismissListeners(): void {
  for (const listener of dismissListeners) {
    listener();
  }
}

function armPointerMoveRelease(): void {
  if (pointerMoveReleaseArmed || typeof document === "undefined") {
    return;
  }
  pointerMoveReleaseArmed = true;
  const release = () => {
    pointerMoveReleaseArmed = false;
    softSuppressed = false;
  };
  document.addEventListener("pointermove", release, {
    capture: true,
    once: true,
  });
}

/**
 * 关闭所有已打开的 tooltip, 并 soft-suppress 到下一次 pointermove.
 * soft-suppress 用来吞掉 Radix delay timer 在 dismiss 之后迟到的 open.
 */
function dismissAllTooltips(): void {
  softSuppressed = true;
  notifyDismissListeners();
  armPointerMoveRelease();
}

/**
 * 硬抑制窗口 (可重入): 用于原生菜单等会夺走 pointer 事件流的场景.
 * 配对调用 releaseTooltipSuppression.
 */
function suppressTooltips(): void {
  hardSuppressCount += 1;
  softSuppressed = true;
  notifyDismissListeners();
}

function releaseTooltipSuppression(): void {
  hardSuppressCount = Math.max(0, hardSuppressCount - 1);
  if (hardSuppressCount === 0 && !pointerMoveReleaseArmed) {
    // 菜单关闭后若指针仍停在 trigger 上, 保持 soft suppress 直到 pointermove,
    // 避免菜单关闭瞬间立刻被残留 hover 重新打开.
    softSuppressed = true;
    armPointerMoveRelease();
  }
}

function subscribeTooltipDismiss(listener: DismissListener): () => void {
  dismissListeners.add(listener);
  return () => {
    dismissListeners.delete(listener);
  };
}

function ensureGlobalDismissListeners(): void {
  if (globalListenersInstalled || typeof document === "undefined") {
    return;
  }
  globalListenersInstalled = true;

  const onDismissSignal = () => {
    dismissAllTooltips();
  };

  document.addEventListener("pointerdown", onDismissSignal, true);
  document.addEventListener("keydown", onDismissSignal, true);
  document.addEventListener("dragstart", onDismissSignal, true);
  window.addEventListener("blur", onDismissSignal);
}

/** 测试用: 清掉 suppress / listener 状态, 不卸载 document 监听 (jsdom 生命周期内复用). */
function resetTooltipDismissStateForTests(): void {
  hardSuppressCount = 0;
  softSuppressed = false;
  pointerMoveReleaseArmed = false;
  dismissListeners.clear();
}

function TooltipProvider({
  delayDuration = 0,
  disableHoverableContent = true,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  React.useEffect(() => {
    ensureGlobalDismissListeners();
  }, []);

  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      disableHoverableContent={disableHoverableContent}
      {...props}
    />
  );
}

function Tooltip({
  defaultOpen = false,
  onOpenChange,
  open: openProp,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  React.useEffect(
    () =>
      subscribeTooltipDismiss(() => {
        if (!isControlled) {
          setUncontrolledOpen(false);
        }
        onOpenChange?.(false);
      }),
    [isControlled, onOpenChange]
  );

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (next && isTooltipSuppressed()) {
        return;
      }
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      {...props}
      onOpenChange={handleOpenChange}
      open={open}
    />
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  align = "center",
  children,
  className,
  side = "top",
  sideOffset = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const overlayRef = useTerminalOverlay();
  const composedRef = useComposedRefs(props.ref, overlayRef);
  const showArrow = side === "top" || side === "bottom";
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        align={align}
        className={cn(
          "app-no-drag data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 inline-flex w-fit max-w-64 origin-(--radix-tooltip-content-transform-origin) items-center gap-1 rounded-xl bg-foreground px-2 py-1 text-[11px] text-background leading-snug has-data-[slot=kbd]:pr-1.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-lg",
          className
        )}
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset}
        {...props}
        ref={composedRef}
      >
        {children}
        {showArrow ? (
          <TooltipPrimitive.Arrow
            aria-hidden="true"
            className="fill-foreground"
            data-slot="tooltip-arrow"
          />
        ) : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export {
  dismissAllTooltips,
  releaseTooltipSuppression,
  resetTooltipDismissStateForTests,
  suppressTooltips,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
};
