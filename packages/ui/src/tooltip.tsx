import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import type * as React from "react";

import { useTerminalOverlay } from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

function TooltipProvider({
  delayDuration = 0,
  disableHoverableContent = true,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
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
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
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
  const arrowXClass =
    align === "start"
      ? "before:left-[calc(var(--radix-tooltip-trigger-width)/2)] before:-translate-x-1/2"
      : align === "end"
        ? "before:right-[calc(var(--radix-tooltip-trigger-width)/2)] before:translate-x-1/2"
        : "before:left-1/2 before:-translate-x-1/2";
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        align={align}
        className={cn(
          "app-no-drag data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 inline-flex w-fit max-w-64 origin-(--radix-tooltip-content-transform-origin) items-center gap-1 rounded-xl bg-foreground px-2 py-1 text-[11px] text-background leading-snug has-data-[slot=kbd]:pr-1.5 data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-lg",
          showArrow &&
            "before:pointer-events-none before:absolute before:size-2.5 before:rotate-45 before:rounded-[2px] before:bg-foreground before:content-[''] data-[side=bottom]:before:top-0 data-[side=top]:before:bottom-0 data-[side=bottom]:before:translate-y-[-50%] data-[side=top]:before:translate-y-[50%]",
          showArrow && arrowXClass,
          className
        )}
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset}
        {...props}
        ref={composedRef}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
