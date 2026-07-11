import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreMissionControlWidgetDeclaration } from "@shared/contracts/mission-control.ts";
import {
  CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
  CORE_CUSTOM_CARD_WIDGET_ID,
  CORE_SYSTEM_RESOURCES_WIDGET_ID,
} from "@shared/plugin-core-contribution-ids.ts";
import { Activity, Blocks, Cpu } from "lucide-react";
import { ActivityWidget } from "./core-widgets/activity-widget.tsx";
import { CustomCardSettings } from "./core-widgets/custom-card/custom-card-settings.tsx";
import { CustomCardWidget } from "./core-widgets/custom-card/custom-card-widget.tsx";
import { SystemResourcesWidget } from "./core-widgets/system-resources-widget.tsx";
import {
  ActivityWidgetPreview,
  CustomCardWidgetPreview,
  SystemResourcesWidgetPreview,
} from "./core-widgets/widget-previews.tsx";

export const CORE_MISSION_CONTROL_WIDGETS: readonly CoreMissionControlWidgetDeclaration[] =
  [
    {
      category: "agent",
      defaultSize: { h: 3, w: 4 },
      descriptionKey: "missionControl.widget.activityOverview.description",
      id: CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
      searchTerms: ["activity", "agent", "session", "活动", "会话"],
      maxSize: { h: 12, w: 12 },
      minSize: { h: 2, w: 3 },
      titleKey: "missionControl.widget.activityOverview.title",
    },
    {
      category: "system",
      defaultSize: { h: 4, w: 4 },
      descriptionKey: "missionControl.widget.systemResources.description",
      id: CORE_SYSTEM_RESOURCES_WIDGET_ID,
      searchTerms: ["cpu", "memory", "load", "内存", "负载", "系统"],
      maxSize: { h: 12, w: 12 },
      minSize: { h: 2, w: 3 },
      refreshable: true,
      titleKey: "missionControl.widget.systemResources.title",
    },
    {
      category: "custom",
      configurable: true,
      defaultSize: { h: 4, w: 3 },
      descriptionKey: "missionControl.widget.customCard.description",
      id: CORE_CUSTOM_CARD_WIDGET_ID,
      searchTerms: ["custom", "kpi", "metric", "自定义", "指标", "组装"],
      maxSize: { h: 12, w: 6 },
      minSize: { h: 2, w: 2 },
      multiInstance: true,
      titleKey: "missionControl.widget.customCard.title",
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
    CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
    {
      component: ActivityWidget,
      icon: Activity,
      id: CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
      previewComponent: ActivityWidgetPreview,
    },
  ],
  [
    CORE_SYSTEM_RESOURCES_WIDGET_ID,
    {
      component: SystemResourcesWidget,
      icon: Cpu,
      id: CORE_SYSTEM_RESOURCES_WIDGET_ID,
      previewComponent: SystemResourcesWidgetPreview,
    },
  ],
  [
    CORE_CUSTOM_CARD_WIDGET_ID,
    {
      component: CustomCardWidget,
      icon: Blocks,
      id: CORE_CUSTOM_CARD_WIDGET_ID,
      previewComponent: CustomCardWidgetPreview,
      settingsComponent: CustomCardSettings,
    },
  ],
]);
