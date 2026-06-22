import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

export function Kbd({
  className,
  ...props
}: HTMLAttributes<HTMLElement>): React.ReactElement {
  return (
    <kbd
      className={clsx(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium text-muted-foreground text-xs",
        className
      )}
      {...props}
    />
  );
}
