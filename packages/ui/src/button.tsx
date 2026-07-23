import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import {
  CONTROL_HEIGHT_CLASS,
  CONTROL_ICON_GLYPH_CLASS,
  CONTROL_ICON_GLYPH_COMPACT_CLASS,
  CONTROL_ICON_GLYPH_SM_CLASS,
  CONTROL_ICON_HIT_COMPACT_CLASS,
  CONTROL_ICON_SIZE_CLASS,
} from "./interactive-density.ts";
import { cn } from "./utils.ts";

const buttonVariants = cva(
  cn(
    "group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full border border-transparent bg-clip-padding font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    CONTROL_ICON_GLYPH_CLASS
  ),
  {
    variants: {
      tone: {
        default: "",
        muted: "text-action-muted hover:text-foreground",
      },
      variant: {
        default:
          "bg-action-accent text-action-accent-foreground hover:bg-action-accent/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-action-secondary-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-action-danger/10 text-action-danger hover:bg-action-danger/20 focus-visible:border-action-danger/40 focus-visible:ring-action-danger/20 dark:bg-action-danger/20 dark:focus-visible:ring-action-danger/40 dark:hover:bg-action-danger/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: cn(
          CONTROL_HEIGHT_CLASS,
          "gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5"
        ),
        // 带文字紧凑钮：缩小 hit 与 glyph；纯图标请用 icon-xs。
        xs: cn(
          "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
          CONTROL_ICON_GLYPH_SM_CLASS
        ),
        sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: CONTROL_ICON_SIZE_CLASS,
        // 紧凑 hit 24 + 14px glyph（size-3.5），与默认 16 / 文字 xs 12 分层。
        "icon-xs": cn(
          CONTROL_ICON_HIT_COMPACT_CLASS,
          CONTROL_ICON_GLYPH_COMPACT_CLASS
        ),
        "icon-sm": CONTROL_ICON_SIZE_CLASS,
        "icon-lg": cn("size-9", "[&_svg:not([class*='size-'])]:size-5"),
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  tone = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, tone, className }))}
      data-size={size}
      data-slot="button"
      data-tone={tone}
      data-variant={variant}
      {...props}
    />
  );
}

export { Button, buttonVariants };
