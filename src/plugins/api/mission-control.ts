import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";

export interface MissionControlWidgetComponentProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  refreshToken: number;
  size: MissionControlGridSize;
  updateParams: (patch: Record<string, JsonValue>) => void;
  /** 所在指挥中心面板不可见时，拉取型物料必须停止轮询。 */
  visible: boolean;
}

export interface MissionControlWidgetSettingsProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface MissionControlWidgetActionContext {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  requestRefresh(): void;
  updateParams(patch: Record<string, JsonValue>): void;
}

export interface RendererMissionControlWidgetAction {
  disabled?: boolean;
  icon: LucideIcon;
  id: string;
  intent?: "default" | "destructive";
  invoke(context: MissionControlWidgetActionContext): Promise<void> | void;
  label: string | (() => string);
  priority?: number;
}

export interface RendererMissionControlWidgetRegistration {
  actions?(
    context: MissionControlWidgetActionContext
  ): readonly RendererMissionControlWidgetAction[];
  component: FunctionComponent<MissionControlWidgetComponentProps>;
  icon: LucideIcon;
  /** 必须在本插件 manifest.missionControlWidgets 中声明。 */
  id: string;
  previewComponent?: FunctionComponent;
  /** 声明 configurable 的物料必须同步提供设置组件。 */
  settingsComponent?: FunctionComponent<MissionControlWidgetSettingsProps>;
  title?: (() => string) | string;
}
