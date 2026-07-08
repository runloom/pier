import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreMissionControlWidgetDeclaration } from "@shared/contracts/mission-control.ts";
import { Activity } from "lucide-react";
import { ActivityWidget } from "./core-widgets/activity-widget.tsx";

export const CORE_MISSION_CONTROL_WIDGETS: readonly CoreMissionControlWidgetDeclaration[] =
  [
    {
      defaultSize: { h: 3, w: 4 },
      descriptionKey: "missionControl.widget.activityOverview.description",
      id: "core.activity-overview",
      minSize: { h: 2, w: 3 },
      titleKey: "missionControl.widget.activityOverview.title",
    },
  ];

/**
 * core widget id → 运行时注册信息（含组件）。
 * 与 CORE_MISSION_CONTROL_WIDGETS 声明表一一对应，指挥中心合并层消费。
 */
export const CORE_MISSION_CONTROL_WIDGET_COMPONENTS: ReadonlyMap<
  string,
  RendererMissionControlWidgetRegistration
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
