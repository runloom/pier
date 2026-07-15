import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "./button.tsx";
import { Skeleton } from "./skeleton.tsx";
import { cn } from "./utils.ts";

/**
 * 工作台物料三态（loading / empty / error）统一形态。
 * core widget 与插件共用；文案由调用方传入（本包不依赖 i18n）。
 */

function WidgetSkeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-full flex-col gap-3 p-3", className)}
      data-slot="widget-skeleton"
      {...props}
    >
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </div>
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-4 w-1/2 rounded-md" />
    </div>
  );
}

interface WidgetEmptyProps extends ComponentProps<"div"> {
  /** 副句（窄卡寸土寸金，默认 ≥14rem 容器才显示）。 */
  hint?: string;
  icon?: LucideIcon;
  title: string;
}

function WidgetEmpty({
  className,
  hint,
  icon: Icon,
  title,
  ...props
}: WidgetEmptyProps) {
  return (
    <div
      className={cn(
        "flex min-h-full flex-1 flex-col items-center justify-center @[14rem]:gap-1.5 gap-1 @[14rem]:py-2 py-0 text-center",
        className
      )}
      data-slot="widget-empty"
      {...props}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="@[14rem]:size-5 size-4 text-muted-foreground/60"
        />
      ) : null}
      <p className="font-medium text-sm">{title}</p>
      {hint ? (
        <p className="@[14rem]:block hidden text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface WidgetErrorProps {
  children?: ReactNode;
  className?: string;
  message: string;
  /** 提供后显示重试按钮（调用方接 refreshToken 递增等重拉逻辑）。 */
  onRetry?: () => void;
  retryLabel?: string;
}

function WidgetError({
  children,
  className,
  message,
  onRetry,
  retryLabel,
}: WidgetErrorProps) {
  // Borderless: widgets already sit in a card; nested Alert frames stack poorly.
  return (
    <div
      className={cn(
        "flex min-h-16 w-full flex-col justify-center gap-1 p-(--card-spacing) text-sm",
        className
      )}
      data-slot="widget-error"
      role="alert"
    >
      {children ? <div className="text-destructive">{children}</div> : null}
      <p
        className={cn(
          "break-all",
          children ? "text-muted-foreground text-xs" : "text-destructive"
        )}
      >
        {message}
      </p>
      {onRetry && retryLabel ? (
        <Button
          className="mt-1 self-start"
          onClick={onRetry}
          size="xs"
          type="button"
          variant="outline"
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export { WidgetEmpty, WidgetError, WidgetSkeleton };
