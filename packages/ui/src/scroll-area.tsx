"use client";

import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "./utils.ts";

type ScrollAreaViewportFade = "horizontal" | "vertical";
type ScrollAreaViewportFadeProfile = "short";

interface ScrollAreaProps
  extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  viewportFade?: ScrollAreaViewportFade;
  viewportFadeProfile?: ScrollAreaViewportFadeProfile;
}

/**
 * Shared fade utilities for ScrollArea viewports and rare native scroll owners
 * that cannot host Radix ScrollArea (cmdk List, Radix menu content, etc.).
 * Prefer ScrollArea `viewportFade` for new product surfaces.
 */
function scrollFadeClassName(options: {
  fade?: ScrollAreaViewportFade | undefined;
  profile?: ScrollAreaViewportFadeProfile | undefined;
}): string {
  if (!options.fade) {
    return "";
  }
  return cn(
    options.fade === "vertical" && "scroll-fade-y",
    options.fade === "horizontal" && "scroll-fade-x",
    options.profile === "short" &&
      "scroll-fade-t-2 scroll-fade-b-4 [--scroll-fade-reveal:24px]"
  );
}

function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportFade,
  viewportFadeProfile,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative", className)}
      data-slot="scroll-area"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          scrollFadeClassName({
            fade: viewportFade,
            profile: viewportFadeProfile,
          }),
          viewportClassName
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      className={cn(
        "flex touch-none select-none p-px transition-colors data-horizontal:h-(--shell-scrollbar-width-legacy) data-vertical:h-full data-vertical:w-(--shell-scrollbar-width-legacy) data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      data-orientation={orientation}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className="relative flex-1 rounded-full bg-(--shell-scrollbar-thumb)"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export {
  ScrollArea,
  type ScrollAreaProps,
  type ScrollAreaViewportFade,
  type ScrollAreaViewportFadeProfile,
  ScrollBar,
  scrollFadeClassName,
};
