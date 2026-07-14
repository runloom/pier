import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { WorkbenchGridSize } from "@shared/contracts/workbench.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";

export interface WorkbenchWidgetComponentProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  refreshToken: number;
  size: WorkbenchGridSize;
  updateParams: (patch: Record<string, JsonValue>) => void;
  /** 所在工作台面板不可见时，拉取型物料必须停止轮询。 */
  visible: boolean;
}

export interface WorkbenchWidgetSettingsProps {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface WorkbenchWidgetActionContext {
  instanceId: string;
  params: Readonly<Record<string, JsonValue>>;
  requestRefresh(): void;
  updateParams(patch: Record<string, JsonValue>): void;
}

export interface RendererWorkbenchWidgetAction {
  disabled?: boolean;
  icon: LucideIcon;
  id: string;
  intent?: "default" | "destructive";
  invoke(context: WorkbenchWidgetActionContext): Promise<void> | void;
  label: string | (() => string);
  priority?: number;
}

export interface RendererWorkbenchWidgetRegistration {
  actions?(
    context: WorkbenchWidgetActionContext
  ): readonly RendererWorkbenchWidgetAction[];
  component: FunctionComponent<WorkbenchWidgetComponentProps>;
  icon: LucideIcon;
  /** 必须在本插件 manifest.workbenchWidgets 中声明。 */
  id: string;
  previewComponent?: FunctionComponent;
  /** 声明 configurable 的物料必须同步提供设置组件。 */
  settingsComponent?: FunctionComponent<WorkbenchWidgetSettingsProps>;
  title?: (() => string) | string;
}
