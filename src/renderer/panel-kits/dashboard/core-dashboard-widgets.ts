import type { RendererDashboardWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreDashboardWidgetDeclaration } from "@shared/contracts/dashboard.ts";
import { Activity } from "lucide-react";
import { ActivityWidget } from "./core-widgets/activity-widget.tsx";

export const CORE_DASHBOARD_WIDGETS: readonly CoreDashboardWidgetDeclaration[] =
  [
    {
      defaultSize: { h: 3, w: 4 },
      descriptionKey: "dashboard.widget.activityOverview.description",
      id: "core.activity-overview",
      minSize: { h: 2, w: 3 },
      titleKey: "dashboard.widget.activityOverview.title",
    },
  ];

/**
 * core widget id → 运行时注册信息（含组件）。
 * 与 CORE_DASHBOARD_WIDGETS 声明表一一对应，大盘合并层消费。
 */
export const CORE_DASHBOARD_WIDGET_COMPONENTS: ReadonlyMap<
  string,
  RendererDashboardWidgetRegistration
> = new Map([
  [
    "core.activity-overview",
    {
      component: ActivityWidget,
      icon: Activity,
      id: "core.activity-overview",
    },
  ],
]);
