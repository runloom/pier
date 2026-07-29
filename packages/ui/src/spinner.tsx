import { Loader2Icon } from "lucide-react";
import { cn } from "./utils.ts";

function Spinner({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  className,
  role,
  ...props
}: React.ComponentProps<"svg">) {
  const hidden = ariaHidden === true || ariaHidden === "true";
  return (
    <Loader2Icon
      aria-hidden={ariaHidden}
      className={cn("size-4 animate-spin", className)}
      data-slot="spinner"
      {...(hidden
        ? {}
        : { "aria-label": ariaLabel ?? "Loading", role: role ?? "status" })}
      {...props}
    />
  );
}

export { Spinner };
