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
 * Shared fade token values for light-DOM Tailwind classes and Shadow/native
 * unsafe CSS. Keep in lockstep with shadcn utilities:
 * - short edges: `scroll-fade-t-2` / `scroll-fade-b-4` (spacing × 2 / × 4)
 * - reveal: `[--scroll-fade-reveal:24px]`
 */
const SCROLL_FADE_REVEAL = "24px";
const SCROLL_FADE_SHORT_START = "calc(var(--spacing, 0.25rem) * 2)";
const SCROLL_FADE_SHORT_END = "calc(var(--spacing, 0.25rem) * 4)";
const SCROLL_FADE_DEFAULT_SIZE =
  "var(--scroll-fade-size, min(12%, calc(var(--spacing, 0.25rem) * 10)))";

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
    // Literals for Tailwind scan (must match SCROLL_FADE_* constants above).
    options.profile === "short" &&
      "scroll-fade-t-2 scroll-fade-b-4 [--scroll-fade-reveal:24px]"
  );
}

/**
 * Shadow DOM / native overflow hosts cannot take Tailwind `scroll-fade-*`
 * classes. Emit the same mask + scroll-driven animation as
 * {@link scrollFadeClassName}, targeted at `selector`.
 *
 * Keyframes / `@property` stay on the document (shadcn); Shadow trees may
 * reference them by name. Prefer this over hand-copied fade CSS in feature
 * modules (file tree, etc.).
 *
 * Note: when `selector` is also the native scrollbar owner (e.g. file-tree
 * virtualized scroll), the mask soft-fades the thumb at edges; auto-hide
 * scrollbar policy keeps idle thumbs transparent.
 */
function scrollFadeUnsafeCss(options: {
  selector: string;
  fade: ScrollAreaViewportFade;
  profile?: ScrollAreaViewportFadeProfile | undefined;
}): string {
  const { selector, fade, profile } = options;
  if (fade === "vertical") {
    if (profile === "bottom-only") {
      return `
${selector} {
  --_scroll-fade-size-b: var(--scroll-fade-b-size, ${SCROLL_FADE_SHORT_END});
  --scroll-fade-reveal: ${SCROLL_FADE_REVEAL};
  --scroll-fade-mask: linear-gradient(
    to bottom,
    #000 0,
    #000 calc(100% - var(--scroll-fade-b, 0px)),
    transparent 100%
  );
  -webkit-mask-image: var(--scroll-fade-mask);
  mask-image: var(--scroll-fade-mask);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

@supports (animation-timeline: scroll()) {
  ${selector} {
    animation: scroll-fade-reveal-b 1ms ease-in-out;
    animation-timeline: scroll(self y);
    animation-range: calc(100% - var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL})) 100%;
    animation-fill-mode: both;
  }
}

@supports not (animation-timeline: scroll()) {
  ${selector} {
    --scroll-fade-b: var(--_scroll-fade-size-b);
  }
}
`.trim();
    }

    const sizeTDecl =
      profile === "short"
        ? `var(--scroll-fade-t-size, ${SCROLL_FADE_SHORT_START})`
        : `var(--scroll-fade-t-size, ${SCROLL_FADE_DEFAULT_SIZE})`;
    const sizeBDecl =
      profile === "short"
        ? `var(--scroll-fade-b-size, ${SCROLL_FADE_SHORT_END})`
        : `var(--scroll-fade-b-size, ${SCROLL_FADE_DEFAULT_SIZE})`;

    return `
${selector} {
  --_scroll-fade-size-t: ${sizeTDecl};
  --_scroll-fade-size-b: ${sizeBDecl};
  --scroll-fade-reveal: ${SCROLL_FADE_REVEAL};
  --scroll-fade-block: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-t, 0px),
    #000 calc(100% - var(--scroll-fade-b, 0px)),
    transparent 100%
  );
  -webkit-mask-image: var(--scroll-fade-mask, var(--scroll-fade-block));
  mask-image: var(--scroll-fade-mask, var(--scroll-fade-block));
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

@supports (animation-timeline: scroll()) {
  ${selector} {
    animation:
      scroll-fade-reveal-t 1ms ease-in-out,
      scroll-fade-reveal-b 1ms ease-in-out;
    animation-timeline: scroll(self y), scroll(self y);
    animation-range:
      0 var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL}),
      calc(100% - var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL})) 100%;
    animation-fill-mode: both;
  }
}

@supports not (animation-timeline: scroll()) {
  ${selector} {
    --scroll-fade-t: var(--_scroll-fade-size-t);
    --scroll-fade-b: var(--_scroll-fade-size-b);
  }
}
`.trim();
  }

  // horizontal
  if (profile === "bottom-only") {
    return `
${selector} {
  --_scroll-fade-size-e: var(--scroll-fade-e-size, ${SCROLL_FADE_SHORT_END});
  --scroll-fade-reveal: ${SCROLL_FADE_REVEAL};
  --scroll-fade-mask: linear-gradient(
    to right,
    #000 0,
    #000 calc(100% - var(--scroll-fade-e, 0px)),
    transparent 100%
  );
  -webkit-mask-image: var(--scroll-fade-mask);
  mask-image: var(--scroll-fade-mask);
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

@supports (animation-timeline: scroll()) {
  ${selector} {
    animation: scroll-fade-reveal-e 1ms ease-in-out;
    animation-timeline: scroll(self inline);
    animation-range: calc(100% - var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL})) 100%;
    animation-fill-mode: both;
  }
}

@supports not (animation-timeline: scroll()) {
  ${selector} {
    --scroll-fade-e: var(--_scroll-fade-size-e);
  }
}
`.trim();
  }

  const sizeS =
    profile === "short"
      ? `var(--scroll-fade-s-size, ${SCROLL_FADE_SHORT_START})`
      : `var(--scroll-fade-s-size, ${SCROLL_FADE_DEFAULT_SIZE})`;
  const sizeE =
    profile === "short"
      ? `var(--scroll-fade-e-size, ${SCROLL_FADE_SHORT_END})`
      : `var(--scroll-fade-e-size, ${SCROLL_FADE_DEFAULT_SIZE})`;

  return `
${selector} {
  --_scroll-fade-size-s: ${sizeS};
  --_scroll-fade-size-e: ${sizeE};
  --scroll-fade-reveal: ${SCROLL_FADE_REVEAL};
  --scroll-fade-inline: linear-gradient(
    to right,
    transparent 0,
    #000 var(--scroll-fade-s, 0px),
    #000 calc(100% - var(--scroll-fade-e, 0px)),
    transparent 100%
  );
  -webkit-mask-image: var(--scroll-fade-mask, var(--scroll-fade-inline));
  mask-image: var(--scroll-fade-mask, var(--scroll-fade-inline));
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

@supports (animation-timeline: scroll()) {
  ${selector} {
    animation:
      scroll-fade-reveal-s 1ms ease-in-out,
      scroll-fade-reveal-e 1ms ease-in-out;
    animation-timeline: scroll(self inline), scroll(self inline);
    animation-range:
      0 var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL}),
      calc(100% - var(--scroll-fade-reveal, ${SCROLL_FADE_REVEAL})) 100%;
    animation-fill-mode: both;
  }
}

@supports not (animation-timeline: scroll()) {
  ${selector} {
    --scroll-fade-s: var(--_scroll-fade-size-s);
    --scroll-fade-e: var(--_scroll-fade-size-e);
  }
}
`.trim();
}

/**
 * 浮层菜单内层滚动视口（Select / Dropdown / Context menu）。
 *
 * 金标准：外壳持有 `bg-popover` / ring / shadow / 圆角裁切，**不得**挂
 * `scroll-fade`（mask 会把实心底色打成半透明，短菜单整板发虚）。
 * 渐隐只落在本层 overflow 视口上，与 ScrollArea `viewportFade` 同构。
 */
function floatingMenuScrollViewportClassName(options?: {
  /** 默认 true：菜单项区 `p-1`；Select Viewport 自管密度时传 false。 */
  padding?: boolean | undefined;
}): string {
  return cn(
    "max-h-[inherit] overflow-y-auto overflow-x-hidden",
    options?.padding === false ? null : "p-1",
    scrollFadeClassName({ fade: "vertical", profile: "short" })
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
  floatingMenuScrollViewportClassName,
  SCROLL_FADE_REVEAL,
  ScrollArea,
  type ScrollAreaProps,
  type ScrollAreaViewportFade,
  type ScrollAreaViewportFadeProfile,
  ScrollBar,
  scrollFadeClassName,
  scrollFadeUnsafeCss,
};
