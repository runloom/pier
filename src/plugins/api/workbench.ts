import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { WorkbenchGridSize } from "@shared/contracts/workbench.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent, ReactNode } from "react";

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
  /**
   * Sticky DialogFooter slot owned by WorkbenchSettingsDialog.
   * Host always provides this; pass null to hide. Use for primary panel
   * actions (e.g. add block), not per-field live edits.
   */
  setFooter: (footer: ReactNode | null) => void;
  updateParams: (patch: Record<string, JsonValue>) => void;
}

export interface WorkbenchWidgetActionContext {
  /**
   * Host "Refresh all" sets this so actions skip their own success toast and
   * rethrow failures for aggregation. Header single-button refresh leaves it
   * unset / false.
   */
  bulkRefresh?: boolean;
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

export type WorkbenchWidgetContentMode = "contained" | "host-scroll";

export interface RendererWorkbenchWidgetRegistration {
  actions?(
    context: WorkbenchWidgetActionContext
  ): readonly RendererWorkbenchWidgetAction[];
  component: FunctionComponent<WorkbenchWidgetComponentProps>;
  /**
   * `host-scroll`（默认）由卡片正文滚动；`contained` 由组件自行组织
   * 固定区、滚动区或裁切区，宿主只负责隐藏溢出。
   */
  contentMode?: WorkbenchWidgetContentMode;
  icon: LucideIcon;
  /** 必须在本插件 manifest.workbenchWidgets 中声明。 */
  id: string;
  previewComponent?: FunctionComponent;
  /** 声明 configurable 的物料必须同步提供设置组件。 */
  settingsComponent?: FunctionComponent<WorkbenchWidgetSettingsProps>;
  title?: (() => string) | string;
}
