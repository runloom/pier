import type { RefinementCtx } from "zod";
import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";

/** 大盘网格列数。契约级常量：w/x 的取值域由它决定。 */
export const DASHBOARD_GRID_COLS = 12;

/** 网格尺寸（单位：格）。 */
export const dashboardGridSizeSchema = z.object({
  h: z.number().int().min(1).max(24),
  w: z.number().int().min(1).max(DASHBOARD_GRID_COLS),
});
export type DashboardGridSize = z.infer<typeof dashboardGridSizeSchema>;

/** 尺寸缺省值（契约级，宿主与校验共用同一真相源）。 */
export const HOST_DEFAULT_WIDGET_SIZE: DashboardGridSize = { h: 3, w: 4 };
export const HOST_MIN_WIDGET_SIZE: DashboardGridSize = { h: 2, w: 2 };
export const HOST_MAX_WIDGET_SIZE: DashboardGridSize = { h: 12, w: 12 };

/**
 * superRefine 校验：按生效值（缺省补齐后）检查 min ≤ default ≤ max 双轴。
 * 违反者 manifest 验证失败——声明不合理应在加载期暴露而非运行期静默 clamp。
 */
function validateWidgetSizeBounds(
  val: {
    defaultSize?: DashboardGridSize | undefined;
    maxSize?: DashboardGridSize | undefined;
    minSize?: DashboardGridSize | undefined;
  },
  ctx: RefinementCtx
): void {
  const min = val.minSize ?? HOST_MIN_WIDGET_SIZE;
  const dflt = val.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE;
  const max = val.maxSize ?? HOST_MAX_WIDGET_SIZE;
  if (min.w > dflt.w || dflt.w > max.w) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `widget size bounds violated on w axis: min.w(${min.w}) ≤ default.w(${dflt.w}) ≤ max.w(${max.w})`,
    });
  }
  if (min.h > dflt.h || dflt.h > max.h) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `widget size bounds violated on h axis: min.h(${min.h}) ≤ default.h(${dflt.h}) ≤ max.h(${max.h})`,
    });
  }
}

/**
 * manifest 贡献点条目 —— widget 接入规范（尺寸部分）：
 * - defaultSize：添加时的初始尺寸；缺省 HOST_DEFAULT_WIDGET_SIZE = { w: 4, h: 3 }。
 * - minSize：resize 下限；缺省 HOST_MIN_WIDGET_SIZE = { w: 2, h: 2 }。
 * - maxSize：resize 上限；缺省 HOST_MAX_WIDGET_SIZE = { w: 12, h: 12 }。
 * superRefine 校验（按生效值，即缺省补齐后）：min.w ≤ default.w ≤ max.w 且
 * min.h ≤ default.h ≤ max.h，违反者 manifest 验证失败。
 */
export const pluginDashboardWidgetContributionSchema = z
  .object({
    defaultSize: dashboardGridSizeSchema.optional(),
    description: z.string().min(1).optional(),
    id: z.string().min(1),
    maxSize: dashboardGridSizeSchema.optional(),
    minSize: dashboardGridSizeSchema.optional(),
    permissions: z.array(pierCapabilitySchema).default([]),
    title: z.string().min(1),
  })
  .superRefine(validateWidgetSizeBounds);
export type PluginDashboardWidgetContribution = z.infer<
  typeof pluginDashboardWidgetContributionSchema
>;

/**
 * 大盘单实例组装清单（存 dockview panel params，随 layout 持久化）。
 * 每项即 react-grid-layout 的一个 layout item（i=id，x/y/w/h 同义直存）。
 */
export const dashboardPanelWidgetEntrySchema = z.object({
  h: z.number().int().min(1),
  id: z.string().min(1), // widget id；单实例语义，同一大盘内去重
  w: z.number().int().min(1).max(DASHBOARD_GRID_COLS),
  x: z
    .number()
    .int()
    .min(0)
    .max(DASHBOARD_GRID_COLS - 1),
  y: z.number().int().min(0),
});

export const dashboardPanelParamsSchema = z.object({
  widgets: z.array(dashboardPanelWidgetEntrySchema),
});
export type DashboardPanelParams = z.infer<typeof dashboardPanelParamsSchema>;

/**
 * params 逐条抢救：整体合法直接返回；否则逐条校验，丢非法项、留合法项。
 * 替代"整体 safeParse 失败 → 空数组"——那条路径会让一条脏数据毁掉整个
 * 大盘组装，且用户下一次编辑就把空布局永久写回。
 * 抢救结果只用于渲染，调用方不得主动回写（避免打开面板即触发写盘）。
 */
export function salvageDashboardPanelParams(
  raw: unknown
): DashboardPanelParams {
  const full = dashboardPanelParamsSchema.safeParse(raw);
  if (full.success) {
    return full.data;
  }
  const widgetsRaw =
    raw !== null && typeof raw === "object" && "widgets" in raw
      ? (raw as { widgets: unknown }).widgets
      : undefined;
  if (!Array.isArray(widgetsRaw)) {
    return { widgets: [] };
  }
  const widgets = widgetsRaw.flatMap((entry) => {
    const parsed = dashboardPanelWidgetEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { widgets };
}

/**
 * Core-owned widget 静态声明，平行于 CoreTerminalStatusItemDeclaration。
 * 尺寸语义同贡献点；titleKey 走全局 i18next.t 解析。
 */
export interface CoreDashboardWidgetDeclaration {
  defaultSize?: DashboardGridSize;
  descriptionKey?: string; // 全局 i18next key（可选副标题）
  id: string; // "core." 前缀
  maxSize?: DashboardGridSize;
  minSize?: DashboardGridSize;
  titleKey: string; // 全局 i18next key
}
