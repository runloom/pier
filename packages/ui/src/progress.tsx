import { cva, type VariantProps } from "class-variance-authority";
import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "./utils.ts";

// 只过渡 transform（指示器靠 translateX 表达进度），避免连带颜色/尺寸等无关
// 属性。数值变化（轮询、刷新）时平滑更新；首次挂载时若 value 已是终值，浏览器
// 通常不会对初始 style 做 transition。
const progressIndicatorVariants = cva(
  "size-full flex-1 transition-transform duration-300 ease-out motion-reduce:transition-none",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-primary",
        destructive: "bg-destructive",
        success: "bg-success",
        warning: "bg-warning",
      },
    },
  }
);

function Progress({
  className,
  value,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-2xl bg-muted",
        className
      )}
      data-slot="progress"
      data-variant={variant}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(progressIndicatorVariants({ variant }))}
        data-slot="progress-indicator"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress, progressIndicatorVariants };
