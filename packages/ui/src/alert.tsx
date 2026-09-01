import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { StatusIcon, type StatusIconKind } from "./status-icon.tsx";
import { cn } from "./utils.ts";

/**
 * Soft alert surfaces follow Ant Design Alert:
 * - background + border carry status color
 * - icon uses the shared StatusIcon set on the first content line
 * - title/description stay on neutral text tokens (not tinted)
 *
 * `layout="callout"` (default): in-content card (settings, Markdown, dialogs).
 * `layout="infobar"`: panel-chrome strip while the primary body remains
 * visible — VS Code / JetBrains analogue. Flush to the panel edge; no extra
 * wrapper padding or second border.
 */
const alertVariants = cva(
  // Grid is [icon | body] when a status icon is present. Free children must
  // not land in the icon track (CJK titles otherwise wrap one glyph per line).
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-foreground text-sm leading-5 has-data-[slot=alert-action]:relative has-[[data-slot=status-icon]]:grid-cols-[auto_1fr] has-[[data-slot=status-icon]]:gap-x-2.5 has-data-[slot=alert-action]:pr-18 *:[data-slot=status-icon]:self-start",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-status-info-border bg-status-info-bg",
        success: "border-status-success-border bg-status-success-bg",
        warning: "border-status-warning-border bg-status-warning-bg",
        destructive: "border-status-danger-border bg-status-danger-bg",
      },
      layout: {
        callout: "",
        infobar: "shrink-0 rounded-none border-x-0 border-t-0",
      },
    },
    defaultVariants: {
      layout: "callout",
      variant: "default",
    },
  }
);

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

const ALERT_STATUS_ICON: Record<AlertVariant, StatusIconKind | null> = {
  default: null,
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "error",
};

function Alert({
  className,
  layout = "callout",
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const resolvedVariant = variant ?? "default";
  const resolvedLayout = layout ?? "callout";
  const iconKind = ALERT_STATUS_ICON[resolvedVariant];

  return (
    <div
      className={cn(
        alertVariants({
          layout: resolvedLayout,
          variant: resolvedVariant,
        }),
        className
      )}
      data-slot="alert"
      data-variant={resolvedVariant}
      role="alert"
      {...props}
      data-layout={resolvedLayout}
    >
      {iconKind ? <StatusIcon kind={iconKind} size="md" /> : null}
      {/*
        Body wrapper owns the content column so free children (not only
        AlertTitle/Description) never land in the ~1ch icon track — that was
        causing CJK titles to stack one glyph per line in canvas demos.
        Absolute AlertAction still positions against this relative root.
      */}
      {iconKind ? (
        <div
          className="col-start-2 grid min-w-0 gap-0.5"
          data-slot="alert-body"
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // Content column is owned by Alert's body wrapper when an icon is present.
        "font-medium text-foreground [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      data-slot="alert-title"
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-balance text-muted-foreground text-sm md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("absolute top-2.5 right-3", className)}
      data-slot="alert-action"
      {...props}
    />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants };
