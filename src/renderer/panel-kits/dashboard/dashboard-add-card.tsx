import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import type { RendererDashboardWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreDashboardWidgetDeclaration } from "@shared/contracts/dashboard.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { LayoutDashboard, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginDashboardWidgetDisplay } from "@/lib/plugins/display.ts";

interface DashboardAddCardProps {
  addedIds: ReadonlySet<string>;
  coreWidgetRegistrations: ReadonlyMap<
    string,
    RendererDashboardWidgetRegistration
  >;
  coreWidgets: readonly CoreDashboardWidgetDeclaration[];
  isEmpty: boolean;
  onAdd: (widgetId: string) => void;
  plugins: readonly PluginRegistryEntry[];
  widgetRegistrations: ReadonlyMap<string, RendererDashboardWidgetRegistration>;
}

export function DashboardAddCard({
  addedIds,
  coreWidgetRegistrations,
  coreWidgets,
  isEmpty,
  onAdd,
  plugins,
  widgetRegistrations,
}: DashboardAddCardProps) {
  const t = useT();
  const locale = i18next.language || "en";
  const [open, setOpen] = useState(false);

  // 先显式关菜单、把变更推迟到本轮事件之后再执行：onAdd 会同步
  // updateParameters 触发整面板重渲，菜单项瞬间翻 disabled 会打断
  // Radix 的 select→close 链，菜单卡开且背景 pointer-events 锁死
  // （表现为"整个大盘拖不动"）。
  const handleSelect = useCallback(
    (widgetId: string) => {
      setOpen(false);
      setTimeout(() => {
        onAdd(widgetId);
      }, 0);
    },
    [onAdd]
  );

  const pluginWidgets = useMemo(() => {
    const items: {
      disabled: boolean;
      icon: RendererDashboardWidgetRegistration["icon"] | null;
      id: string;
      title: string;
    }[] = [];

    for (const entry of plugins) {
      if (!entry.runtime.enabled) {
        continue;
      }
      for (const widget of entry.manifest.dashboardWidgets) {
        const reg = widgetRegistrations.get(widget.id);
        const display = resolvePluginDashboardWidgetDisplay(
          entry.manifest,
          widget,
          locale
        );
        items.push({
          disabled: addedIds.has(widget.id),
          icon: reg?.icon ?? null,
          id: widget.id,
          title: display.title,
        });
      }
    }
    return items;
  }, [plugins, widgetRegistrations, addedIds, locale]);

  const menuContent = (
    <DropdownMenuContent
      align="start"
      className="max-h-[min(var(--radix-dropdown-menu-content-available-height),480px)] w-56"
      data-scrollbar="none"
    >
      {coreWidgets.length > 0 ? (
        <>
          <DropdownMenuLabel>
            {t("dashboard.picker.coreSection")}
          </DropdownMenuLabel>
          {coreWidgets.map((cw) => {
            const added = addedIds.has(cw.id);
            return (
              <DropdownMenuItem
                data-testid={`dashboard-widget-picker-item-${cw.id}`}
                disabled={added}
                key={cw.id}
                onSelect={() => {
                  if (!added) {
                    handleSelect(cw.id);
                  }
                }}
              >
                {(() => {
                  const CoreIcon = coreWidgetRegistrations.get(cw.id)?.icon;
                  return CoreIcon ? <CoreIcon className="mr-1 size-4" /> : null;
                })()}
                <span>{t(cw.titleKey)}</span>
              </DropdownMenuItem>
            );
          })}
        </>
      ) : null}
      {pluginWidgets.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {t("dashboard.picker.pluginSection")}
          </DropdownMenuLabel>
          {pluginWidgets.map((pw) => {
            const Icon = pw.icon;
            return (
              <DropdownMenuItem
                data-testid={`dashboard-widget-picker-item-${pw.id}`}
                disabled={pw.disabled}
                key={pw.id}
                onSelect={() => {
                  if (!pw.disabled) {
                    handleSelect(pw.id);
                  }
                }}
              >
                {Icon ? <Icon className="mr-1 size-4" /> : null}
                <span>{pw.title}</span>
              </DropdownMenuItem>
            );
          })}
        </>
      ) : null}
    </DropdownMenuContent>
  );

  if (isEmpty) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center pb-16">
        <Empty className="border-0 py-8" data-testid="dashboard-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard />
            </EmptyMedia>
            <EmptyTitle>{t("dashboard.empty")}</EmptyTitle>
            <EmptyDescription>
              {t("dashboard.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <DropdownMenu onOpenChange={setOpen} open={open}>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid="dashboard-add-widget"
                  size="sm"
                  variant="outline"
                >
                  <Plus className="mr-1.5 size-4" />
                  {t("dashboard.addWidget")}
                </Button>
              </DropdownMenuTrigger>
              {menuContent}
            </DropdownMenu>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  // 幽灵卡：与真实卡片同圆角、填满调用方给的网格空位容器，
  // 作为"网格里的下一个卡位"而非横贯全宽的分区横幅。
  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex size-full flex-col items-center justify-center gap-2 rounded-xl border border-border/60 border-dashed text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
          data-testid="dashboard-add-widget"
          type="button"
        >
          <Plus className="size-5" />
          <span>{t("dashboard.addWidget")}</span>
        </button>
      </DropdownMenuTrigger>
      {menuContent}
    </DropdownMenu>
  );
}
