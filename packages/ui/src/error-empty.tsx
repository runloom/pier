import { RefreshCw } from "lucide-react";
import { Button } from "./button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty.tsx";
import { StatusIcon } from "./status-icon.tsx";
import { cn } from "./utils.ts";

interface ErrorEmptyAction {
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * 内容区没有可展示正文时的错误主体状态(对齐 StartupErrorScreen 语汇)。
 * 错误占据整个区域时用它替代 Alert 横条;内容仍可见的非阻塞提示才用 Alert。
 * 文案由调用方本地化后传入;技术详情不内联,通过 detailAction 打开对话框。
 */
function ErrorEmpty({
  className,
  description,
  detailAction,
  retryAction,
  title,
  ...props
}: React.ComponentProps<"div"> & {
  readonly description?: string | undefined;
  readonly detailAction?: ErrorEmptyAction | undefined;
  readonly retryAction?: ErrorEmptyAction | undefined;
  readonly title: string;
}) {
  return (
    <Empty
      className={cn("h-full", className)}
      data-slot="error-empty"
      role="status"
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia>
          <StatusIcon kind="error" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {retryAction || detailAction ? (
        <EmptyContent>
          <div className="flex gap-2">
            {retryAction ? (
              <Button onClick={retryAction.onClick} size="sm" type="button">
                <RefreshCw aria-hidden data-icon="inline-start" />
                {retryAction.label}
              </Button>
            ) : null}
            {detailAction ? (
              <Button
                onClick={detailAction.onClick}
                size="sm"
                type="button"
                variant="outline"
              >
                {detailAction.label}
              </Button>
            ) : null}
          </div>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

export { ErrorEmpty };
