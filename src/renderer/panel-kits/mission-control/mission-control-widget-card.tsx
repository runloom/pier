import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";
import { GripVertical, Trash2 } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useMemo } from "react";
import { useT } from "@/i18n/use-t.ts";
import type { ResolvedMissionControlWidget } from "./mission-control-merge.ts";

interface WidgetErrorBoundaryProps {
  children: ReactNode;
  widgetId: string;
}

interface WidgetErrorBoundaryState {
  error: Error | null;
}

class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[mission-control] widget ${this.props.widgetId} crashed:`,
      error,
      info.componentStack
    );
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Alert className="m-3" variant="destructive">
          <AlertDescription>
            {this.state.error.message || "Widget error"}
          </AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}

interface MissionControlWidgetCardProps {
  onRemove: () => void;
  size: MissionControlGridSize;
  widget: ResolvedMissionControlWidget;
}

export function MissionControlWidgetCard({
  onRemove,
  size,
  widget,
}: MissionControlWidgetCardProps) {
  const t = useT();

  const title = useMemo(() => {
    if (widget.status === "core") {
      return t(widget.title);
    }
    return widget.title;
  }, [widget.status, widget.title, t]);

  const description = useMemo(() => {
    if (!widget.description) {
      return;
    }
    if (widget.status === "core") {
      return t(widget.description);
    }
    return widget.description;
  }, [widget.status, widget.description, t]);

  const Icon = widget.registration?.icon;

  const renderBody = (): ReactNode => {
    if (widget.status === "plugin-disabled") {
      return (
        <div className="flex items-center justify-center p-4 text-muted-foreground text-sm">
          {t("missionControl.widget.pluginDisabled")}
        </div>
      );
    }
    if (widget.status === "unknown") {
      return (
        <Alert className="m-3" variant="destructive">
          <AlertDescription className="flex flex-col items-center gap-2">
            <span>{t("missionControl.widget.unknown")}</span>
            <Button onClick={onRemove} size="xs" variant="destructive">
              {t("missionControl.widget.remove")}
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    if (!widget.registration) {
      return (
        <div className="flex items-center justify-center p-4 text-muted-foreground text-sm">
          {t("missionControl.widget.loading")}
        </div>
      );
    }
    const WidgetComponent = widget.registration.component;
    return (
      <WidgetErrorBoundary widgetId={widget.id}>
        <WidgetComponent size={size} />
      </WidgetErrorBoundary>
    );
  };

  return (
    <Card
      // rounded-xl 覆盖 Card 原语的 24px 大圆角——密集网格里的 widget 卡
      // 用 12px 更紧凑（幽灵卡/拖拽占位框同步此值）
      className="group h-full gap-0 rounded-xl py-0 [--card-spacing:--spacing(3)]"
      data-testid={`mission-control-widget-${widget.id}`}
    >
      <CardHeader className="mission-control-widget-drag-handle cursor-grab items-center gap-0.5 border-border/60 border-b pt-3 active:cursor-grabbing">
        <CardTitle className="flex items-center gap-1.5 font-semibold text-sm">
          <GripVertical className="-ml-0.5 size-3.5 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
          {Icon ? (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate">{title}</span>
        </CardTitle>
        {description ? (
          <CardDescription className="col-span-full text-xs">
            {description}
          </CardDescription>
        ) : null}
        <CardAction>
          <Button
            aria-label={t("missionControl.widget.remove")}
            className="text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
            onClick={onRemove}
            size="icon-xs"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </CardAction>
      </CardHeader>
      {/* overflow-y-auto：卡片高度是用户拖出的格子数，内容装不下时滚动而非裁切 */}
      <CardContent
        className="@container min-h-0 flex-1 overflow-y-auto p-0"
        data-scrollbar="stable"
      >
        {renderBody()}
      </CardContent>
    </Card>
  );
}
