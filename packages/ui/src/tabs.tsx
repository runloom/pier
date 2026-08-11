import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";

import { CONTROL_HEIGHT_CLASS } from "./interactive-density.ts";
import { cn } from "./utils.ts";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      data-orientation={orientation}
      data-slot="tabs"
      {...props}
    />
  );
}

const tabsListVariants = cva(
  cn(
    CONTROL_HEIGHT_CLASS,
    "group/tabs-list inline-flex w-fit items-center justify-center rounded-2xl p-[3px] text-muted-foreground data-[variant=line]:rounded-none group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:overflow-y-auto group-data-vertical/tabs:overflow-x-hidden group-data-vertical/tabs:p-1"
  ),
  {
    variants: {
      variant: {
        // Pin overflow-y on the default (pill) track. CSS overflow-axis pairing
        // turns a lone overflow-x-auto into overflow-y:auto; without this, a 1px
        // taller trigger (or overlay pin) shows a spurious vertical scrollbar.
        // Line variant keeps y visible so the active underline (bottom-[-5px]) is not clipped.
        default: "overflow-y-hidden bg-muted",
        line: "gap-4 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      className={cn(tabsListVariants({ variant }), className)}
      data-slot="tabs-list"
      data-variant={variant}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl border border-transparent! px-1.5 py-0.5 font-medium text-foreground/60 text-sm transition-all hover:text-foreground focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-3 group-data-vertical/tabs:py-0.5 dark:text-muted-foreground dark:hover:text-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:px-2.5 group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:shadow-none dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Dark: avoid bg-input/30 — --input is already 15% white, /30 stacks to ~4.5% on muted.
        "data-active:bg-background data-active:text-foreground data-active:shadow-sm dark:data-active:border-transparent dark:data-active:bg-foreground/15 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("flex-1 text-sm outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
