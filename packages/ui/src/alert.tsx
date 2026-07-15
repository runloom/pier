import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { StatusIcon, type StatusIconKind } from "./status-icon.tsx";
import { cn } from "./utils.ts";

/**
 * Soft alert surfaces follow Ant Design Alert:
 * - background + border carry status color
 * - icon uses the shared StatusIcon set (same as toast)
 * - title/description stay on neutral text tokens (not tinted)
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-4 py-3 text-left text-foreground text-sm has-data-[slot=alert-action]:relative has-[[data-slot=status-icon]]:grid-cols-[auto_1fr] has-[[data-slot=status-icon]]:gap-x-2.5 has-data-[slot=alert-action]:pr-18 *:[data-slot=status-icon]:row-span-2 *:[data-slot=status-icon]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-status-info-border bg-status-info-bg",
        success: "border-status-success-border bg-status-success-bg",
        warning: "border-status-warning-border bg-status-warning-bg",
        destructive: "border-status-danger-border bg-status-danger-bg",
      },
    },
    defaultVariants: {
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
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const resolvedVariant = variant ?? "default";
  const iconKind = ALERT_STATUS_ICON[resolvedVariant];

  return (
    <div
      className={cn(alertVariants({ variant: resolvedVariant }), className)}
      data-slot="alert"
      data-variant={resolvedVariant}
      role="alert"
      {...props}
    >
      {iconKind ? <StatusIcon kind={iconKind} /> : null}
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "font-medium text-foreground group-has-[[data-slot=status-icon]]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
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
        "text-balance text-muted-foreground text-sm group-has-[[data-slot=status-icon]]/alert:col-start-2 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
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
