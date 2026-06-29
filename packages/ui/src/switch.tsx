import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "./utils.ts";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-2xl border-2 outline-none transition-all after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=sm]:h-4 data-[size=default]:w-8 data-[size=sm]:w-6 data-disabled:cursor-not-allowed data-checked:border-primary data-unchecked:border-transparent data-checked:bg-primary data-unchecked:bg-input/90 data-disabled:opacity-50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      data-size={size}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block rounded-2xl bg-background not-dark:bg-clip-padding shadow-sm ring-0 transition-transform data-checked:translate-x-[calc(100%-4px)] data-unchecked:translate-x-0 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
