"use client";

import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "./utils.ts";

/**
 * Overlay hairline tokens (dropdown / context / menubar / select / command /
 * create-menu footer / notification popover).
 *
 * See AGENTS.md 「浮层分割线」 and
 * docs/superpowers/specs/2026-09-03-overlay-separator-gold-standard.md.
 * Do not invent a third mx or a second hairline color in call sites.
 */

/** `p-1` menu shell: cancel padding so the hairline meets the rounded chrome. */
export const OVERLAY_MENU_SEPARATOR_CLASS = "-mx-1 my-1 h-px bg-border/50";

/** `p-0` overlay: full-bleed `Separator` color (title vs list). */
export const OVERLAY_REGION_SEPARATOR_CLASS = "bg-border/50";

/**
 * `p-0` overlay footer chrome: top rule + item padding. Keep the button at
 * default 28px density; do not add `mx-*`.
 */
export const OVERLAY_REGION_FOOTER_CLASS = "border-border/50 border-t p-1";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}

export { Separator };
