import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import { ScrollArea } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { ComponentProps, ReactNode } from "react";

export interface AccountWidgetFrameProps
  extends Omit<ComponentProps<"div">, "children"> {
  children: ReactNode;
  density: WidgetDensity;
  header?: ReactNode;
}

/**
 * Shared account-widget geometry: identity remains pinned while the usage
 * viewport owns scrolling, edge fade, and its overlay scrollbar.
 */
export function AccountWidgetFrame({
  children,
  className,
  density,
  header,
  ...props
}: AccountWidgetFrameProps) {
  const compact = density === "compact";
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        className
      )}
      {...props}
    >
      {header ? (
        <div
          className={cn(
            "shrink-0",
            compact ? "px-2.5 pt-2.5 pb-2" : "px-3 pt-3 pb-3"
          )}
          data-slot="account-widget-header"
        >
          {header}
        </div>
      ) : null}
      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportClassName="overscroll-contain"
        viewportFade="vertical"
        viewportFadeProfile="short"
      >
        <div
          className={cn(
            "flex min-w-0 flex-col",
            compact ? "px-2.5 pb-3" : "px-3 pb-4",
            !header && (compact ? "pt-2.5" : "pt-3")
          )}
          data-slot="account-widget-usage-content"
        >
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}
