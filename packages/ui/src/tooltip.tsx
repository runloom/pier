import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import * as React from "react";

import { useFreezeFloatingOnClose } from "./freeze-floating-on-close.ts";
import { useTerminalOverlay } from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

/**
 * Product gold standard for `@pier/ui` tooltips (all call sites inherit):
 * - sideOffset 6px — avoid 0px edge collision / flip jitter on tight chrome
 * - collisionPadding — keep clear of viewport / titlebar; horizontal is slightly
 *   tighter than vertical so edge chrome (panel actions) stay on-screen
 * - arrowPadding — inset the caret from the bubble L/R extremes; must be
 *   ≥ `rounded-xl` so the 2:1 triangle base sits on the flat edge
 * - Caret: Radix SVG isosceles triangle (width:height = 2:1), not a
 *   rotated rounded square. Diamonds on a compact `rounded-xl` pill
 *   collapse to a nub once you sink them to hide the AA seam.
 *   1px overlap (`-translate-y-px`) tucks the base into the fill so the
 *   join does not show a hairline; it does not eat the visible triangle.
 *   Visibility is CSS-only in `src/renderer/app/globals.css`:
 *   top / bottom always show (including viewport edges); left / right hide
 *   with `visibility` (not `display`) so collision flip does not collapse gap.
 * - sticky partial — arrow stays on the content edge while pointing at trigger
 * - fade only (no zoom) — Floating UI already drives transform for placement
 * - pointer-events-none — content must never steal hover from the trigger
 * - disableHoverableContent on Provider — no sticky hover bridge
 */
export const TOOLTIP_SIDE_OFFSET_PX = 6;
/** Vertical inset from viewport / titlebar. */
export const TOOLTIP_COLLISION_PADDING_PX = 8;
/** Horizontal inset from viewport for edge chrome (panel actions, gutters). */
export const TOOLTIP_COLLISION_PADDING_X_PX = 6;
/** `rounded-xl` on TooltipContent: `--radius` 10px + 6px. */
export const TOOLTIP_CONTENT_RADIUS_PX = 16;
/** Tuck the triangle base into the pill. 1px hides the AA seam. */
export const TOOLTIP_ARROW_OVERLAP_PX = 1;
/** Inset of the caret along the bubble edge. Keep the join off rounded-xl. */
export const TOOLTIP_ARROW_PADDING_PX = TOOLTIP_CONTENT_RADIUS_PX;
/** SVG triangle base. 2:1 with height, matching Radix default / Base UI. */
export const TOOLTIP_ARROW_WIDTH_PX = 12;
/** SVG triangle height. Radix `sideOffset + height` is the trigger gap. */
export const TOOLTIP_ARROW_HEIGHT_PX = 6;
export const TOOLTIP_ARROW_SIZE_PX = TOOLTIP_ARROW_WIDTH_PX;

export const TOOLTIP_COLLISION_PADDING = {
  top: TOOLTIP_COLLISION_PADDING_PX,
  right: TOOLTIP_COLLISION_PADDING_X_PX,
  bottom: TOOLTIP_COLLISION_PADDING_PX,
  left: TOOLTIP_COLLISION_PADDING_X_PX,
} as const;

/** Native Radix SVG triangle. Local -Y is into the pill on top/bottom. */
export const TOOLTIP_ARROW_CLASS =
  "relative z-50 fill-foreground -translate-y-px";

type DismissListener = () => void;

const dismissListeners = new Set<DismissListener>();
let hardSuppressCount = 0;
let softSuppressed = false;
let pointerMoveReleaseArmed = false;
let focusInputModality: "keyboard" | "pointer" = "keyboard";
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

  const onPointerDismissSignal = () => {
    focusInputModality = "pointer";
    dismissAllTooltips();
  };
  const onKeyboardDismissSignal = () => {
    focusInputModality = "keyboard";
    dismissAllTooltips();
  };

  document.addEventListener("pointerdown", onPointerDismissSignal, true);
  document.addEventListener("keydown", onKeyboardDismissSignal, true);
  document.addEventListener("dragstart", onPointerDismissSignal, true);
  window.addEventListener("blur", dismissAllTooltips);
}

/** 测试用: 清掉 suppress / listener 状态, 不卸载 document 监听 (jsdom 生命周期内复用). */
function resetTooltipDismissStateForTests(): void {
  hardSuppressCount = 0;
  softSuppressed = false;
  pointerMoveReleaseArmed = false;
  focusInputModality = "keyboard";
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
  onFocus,
  openOnFocus = false,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  /**
   * When true, keyboard focus may open the tooltip.
   * Focus-open is disabled by default; keep help on hover unless a caller
   * has a verified keyboard-discovery need.
   */
  openOnFocus?: boolean;
}) {
  const handleFocus = React.useCallback(
    (event: React.FocusEvent<HTMLButtonElement>) => {
      if (!openOnFocus) {
        onFocus?.(event);
        event.preventDefault();
        return;
      }
      if (focusInputModality === "keyboard") {
        softSuppressed = false;
      }
      onFocus?.(event);
      if (focusInputModality === "pointer") {
        event.preventDefault();
      }
    },
    [onFocus, openOnFocus]
  );
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      onFocus={handleFocus}
    />
  );
}

function TooltipContent({
  align = "center",
  arrowPadding = TOOLTIP_ARROW_PADDING_PX,
  children,
  className,
  collisionPadding = TOOLTIP_COLLISION_PADDING,
  side = "top",
  sideOffset = TOOLTIP_SIDE_OFFSET_PX,
  sticky = "partial",
  style,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const overlayRef = useTerminalOverlay();
  const freezeRef = useFreezeFloatingOnClose();
  const composedRef = useComposedRefs(props.ref, overlayRef, freezeRef);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        align={align}
        arrowPadding={arrowPadding}
        className={cn(
          // Fade only: zoom/slide also use transform and fight Floating UI placement
          // updates (visible as hover jitter on tight chrome like panel maximize).
          "app-no-drag data-[state=delayed-open]:fade-in-0 data-open:fade-in-0 data-closed:fade-out-0 pointer-events-none relative z-50 inline-flex w-fit max-w-64 origin-(--radix-tooltip-content-transform-origin) items-center gap-1 overflow-visible rounded-xl bg-foreground px-2 py-1 text-background text-xs leading-snug duration-100 has-data-[slot=kbd]:pr-1.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-lg",
          // Room for arrowPadding on both ends + triangle base so the caret
          // stays on the flat edge (not the rounded-xl corner).
          "min-w-[calc(var(--tooltip-arrow-pad)*2+var(--tooltip-arrow-size))]",
          className
        )}
        collisionPadding={collisionPadding}
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset}
        sticky={sticky}
        style={
          {
            "--tooltip-arrow-pad": `${arrowPadding}px`,
            "--tooltip-arrow-size": `${TOOLTIP_ARROW_SIZE_PX}px`,
            ...style,
          } as React.CSSProperties
        }
        {...props}
        ref={composedRef}
      >
        {children}
        <TooltipPrimitive.Arrow
          className={TOOLTIP_ARROW_CLASS}
          data-slot="tooltip-arrow"
          height={TOOLTIP_ARROW_HEIGHT_PX}
          width={TOOLTIP_ARROW_WIDTH_PX}
        />
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
