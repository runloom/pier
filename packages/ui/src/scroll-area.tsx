"use client";

import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import type * as React from "react";

import { AUTO_HIDE_SCROLLBAR_IDLE_MS } from "./auto-hide-scrollbar.ts";
import { cn } from "./utils.ts";

type ScrollAreaViewportFade = "horizontal" | "vertical";
type ScrollAreaViewportFadeProfile = "short" | "bottom-only";

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
 *
 * Scrollbar policy (align native auto-hide + terminal overlay):
 * - Default `type="scroll"`: reveal on scroll activity, hide after idle.
 * - Default hide delay matches `AUTO_HIDE_SCROLLBAR_IDLE_MS` (900).
 * - Do not default to `type="hover"` (whole-container hover); that diverges
 *   from native gutter/scroll policy and terminal AppKit overlay.
 * - Opt into `type="hover"` only for small ephemeral surfaces with a comment.
 * - Intentional hide stays on native owners via `data-scrollbar="none"`.
 *
 * Fade profiles:
 * - `short`: tighter top/bottom bands for compact contained viewports.
 * - `bottom-only`: end-edge fade only — use when sticky chrome (e.g. settings
 *   project tabs) sits at the start of the scrollport so a top mask would
 *   wrongly dim content under the tabs.
 */
function scrollFadeClassName(options: {
  fade?: ScrollAreaViewportFade | undefined;
  profile?: ScrollAreaViewportFadeProfile | undefined;
}): string {
  if (!options.fade) {
    return "";
  }
  if (options.profile === "bottom-only") {
    return cn(
      options.fade === "vertical" &&
        "scroll-fade-b scroll-fade-b-4 [--scroll-fade-reveal:24px]",
      options.fade === "horizontal" &&
        "scroll-fade-e scroll-fade-e-4 [--scroll-fade-reveal:24px]"
    );
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
  type = "scroll",
  scrollHideDelay = AUTO_HIDE_SCROLLBAR_IDLE_MS,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative", className)}
      data-slot="scroll-area"
      scrollHideDelay={scrollHideDelay}
      type={type}
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
      <ScrollBar orientation="horizontal" />
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
        "flex touch-none select-none p-px opacity-0 transition-opacity duration-200 data-[state=hidden]:pointer-events-none data-horizontal:h-(--shell-scrollbar-width-legacy) data-vertical:h-full data-vertical:w-(--shell-scrollbar-width-legacy) data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:border-l data-vertical:border-l-transparent data-[state=visible]:opacity-100",
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
