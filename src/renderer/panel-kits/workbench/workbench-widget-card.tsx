import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import type {
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
} from "@plugins/api/renderer.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { WorkbenchGridSize } from "@shared/contracts/workbench.ts";
import {
  Copy,
  GripVertical,
  PackageX,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useId } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import type { ResolvedWorkbenchWidget } from "./workbench-merge.ts";
import {
  type WidgetHeaderAction,
  WorkbenchWidgetActions,
} from "./workbench-widget-actions.tsx";
import { WidgetErrorBoundary } from "./workbench-widget-error-boundary.tsx";

interface WorkbenchWidgetCardProps {
  onDuplicate: () => void;
  onLayoutKeyDown: (
    event: KeyboardEvent<HTMLButtonElement>,
    title: string
  ) => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  refreshToken: number;
  size: WorkbenchGridSize;
  updateParams: (patch: Record<string, JsonValue>) => void;
  visible: boolean;
  widget: ResolvedWorkbenchWidget;
}

const LAYOUT_KEY_SHORTCUTS =
  "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown";
export function WorkbenchWidgetCard({
  onDuplicate,
  onOpenSettings,
  onRefresh,
  onLayoutKeyDown,
  onRemove,
  refreshToken,
  size,
  updateParams,
  visible,
  widget,
}: WorkbenchWidgetCardProps) {
  const t = useT();
  const layoutInstructionsId = useId();

  const title = widget.status === "core" ? t(widget.title) : widget.title;
  const description =
    widget.description && widget.status === "core"
      ? t(widget.description)
      : widget.description;

  const Icon = widget.registration?.icon;

  const confirmRemove = async (): Promise<void> => {
    const confirmed = await showAppConfirm({
      body: t("workbench.removeConfirmBody"),
      intent: "destructive",
      size: "sm",
      title: t("workbench.removeConfirmTitle"),
    });
    if (confirmed) {
      onRemove();
    }
  };

  const actionContext: WorkbenchWidgetActionContext = {
    instanceId: widget.instanceId,
    params: widget.params,
    requestRefresh: onRefresh,
    updateParams,
  };
  let pluginActions: readonly RendererWorkbenchWidgetAction[] = [];
  try {
    pluginActions = widget.registration?.actions?.(actionContext) ?? [];
  } catch (error) {
    console.error(
      `[workbench] widget actions failed: ${widget.widgetId}`,
      error
    );
  }
  const resolveActionLabel = (
    label: RendererWorkbenchWidgetAction["label"]
  ): string => {
    try {
      return typeof label === "function" ? label() : label;
    } catch {
      return t("workbench.widget.action");
    }
  };
  const headerActions: WidgetHeaderAction[] = [
    ...pluginActions.map(
      (action): WidgetHeaderAction => ({
        ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
        icon: action.icon,
        id: `plugin:${action.id}`,
        ...(action.intent === undefined ? {} : { intent: action.intent }),
        invoke: () => action.invoke(actionContext),
        label: resolveActionLabel(action.label),
        priority: action.priority ?? 60,
      })
    ),
    ...(widget.refreshable &&
    (widget.status === "core" || widget.status === "plugin-active")
      ? [
          {
            icon: RefreshCw,
            id: "host:refresh",
            invoke: onRefresh,
            label: t("workbench.widget.refresh"),
            priority: 50,
          } satisfies WidgetHeaderAction,
        ]
      : []),
    ...(widget.configurable && widget.registration?.settingsComponent
      ? [
          {
            icon: Settings2,
            id: "host:settings",
            invoke: onOpenSettings,
            label: t("workbench.widget.settings"),
            priority: 40,
            testId: "workbench-widget-menu-settings",
          } satisfies WidgetHeaderAction,
        ]
      : []),
    ...(widget.multiInstance
      ? [
          {
            icon: Copy,
            id: "host:duplicate",
            invoke: onDuplicate,
            label: t("workbench.widget.duplicate"),
            priority: 20,
            testId: "workbench-widget-menu-duplicate",
          } satisfies WidgetHeaderAction,
        ]
      : []),
    ...(widget.status === "unknown"
      ? []
      : [
          {
            icon: Trash2,
            id: "host:remove",
            intent: "destructive",
            invoke: confirmRemove,
            label: t("workbench.widget.remove"),
            priority: 10,
            testId: "workbench-widget-menu-remove",
          } satisfies WidgetHeaderAction,
        ]),
  ]
    .map((action, index) => ({ action, index }))
    .sort(
      (left, right) =>
        right.action.priority - left.action.priority || left.index - right.index
    )
    .map(({ action }) => action);

  const renderBody = (): React.ReactNode => {
    if (widget.status === "plugin-disabled") {
      return (
        <Empty className="h-full p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageX />
            </EmptyMedia>
            <EmptyTitle>{t("workbench.widget.pluginDisabled")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    }
    if (widget.status === "unknown") {
      return (
        <Empty className="h-full p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageX />
            </EmptyMedia>
            <EmptyTitle>{t("workbench.widget.unknownTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("workbench.widget.unknownDescription")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              data-testid="workbench-widget-unknown-remove"
              onClick={async () => {
                await confirmRemove();
              }}
              variant="outline"
            >
              {t("workbench.widget.remove")}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    if (!widget.registration) {
      return <WidgetSkeleton data-testid="workbench-widget-loading" />;
    }
    const WidgetComponent = widget.registration.component;
    return (
      <WidgetErrorBoundary
        fallbackMessage={t("workbench.widget.errorFallback")}
        onRetry={onRefresh}
        resetKey={refreshToken}
        retryLabel={t("workbench.widget.retry")}
        widgetId={widget.widgetId}
      >
        <WidgetComponent
          instanceId={widget.instanceId}
          params={widget.params}
          refreshToken={refreshToken}
          size={size}
          updateParams={updateParams}
          visible={visible}
        />
      </WidgetErrorBoundary>
    );
  };

  return (
    <Card
      className="group h-full gap-0 rounded-xl py-0 [--card-spacing:--spacing(3)]"
      data-testid={`workbench-widget-${widget.instanceId}`}
      data-widget-id={widget.widgetId}
    >
      <CardHeader className="min-h-9 select-none items-center gap-1 px-3 py-1.5">
        <CardTitle className="flex min-w-24 items-center gap-1.5 font-semibold text-sm">
          <button
            aria-describedby={layoutInstructionsId}
            aria-keyshortcuts={LAYOUT_KEY_SHORTCUTS}
            aria-label={t("workbench.widget.layoutHandle", { title })}
            className="workbench-widget-drag-handle -ml-1 flex size-5 cursor-grab items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground opacity-40 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing group-hover:opacity-100"
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "ArrowUp" &&
                event.key !== "ArrowDown"
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onLayoutKeyDown(event, title);
            }}
            type="button"
          >
            <GripVertical aria-hidden="true" className="size-3.5" />
          </button>
          <span className="sr-only" id={layoutInstructionsId}>
            {t("workbench.widget.layoutInstructions")}
          </span>
          {Icon ? (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {/* 描述不占卡头第二行（挤压内容区），挂 title 提示即可 */}
          <span className="truncate" title={description ?? undefined}>
            {title}
          </span>
        </CardTitle>
        <CardAction className="min-w-0 self-center">
          <WorkbenchWidgetActions actions={headerActions} />
        </CardAction>
      </CardHeader>
      <CardContent
        className="@container min-h-0 flex-1 overflow-y-auto p-0"
        data-scrollbar="stable"
      >
        {renderBody()}
      </CardContent>
    </Card>
  );
}
