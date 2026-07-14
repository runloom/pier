import type { RefinementCtx } from "zod";
import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";
import { jsonValueSchema } from "./plugin-settings.ts";

/** 工作台网格列数，也是贡献声明尺寸的单轴上限。 */
export const WORKBENCH_GRID_COLS = 12;

/** 网格尺寸（单位：格）。 */
export const workbenchGridSizeSchema = z.object({
  h: z.number().int().min(2).max(WORKBENCH_GRID_COLS),
  w: z.number().int().min(2).max(WORKBENCH_GRID_COLS),
});
export type WorkbenchGridSize = z.infer<typeof workbenchGridSizeSchema>;

/** 尺寸缺省值（契约级，宿主与校验共用同一真相源）。 */
export const HOST_DEFAULT_WIDGET_SIZE: WorkbenchGridSize = { h: 3, w: 4 };
export const HOST_MIN_WIDGET_SIZE: WorkbenchGridSize = { h: 2, w: 2 };
export const HOST_MAX_WIDGET_SIZE: WorkbenchGridSize = { h: 12, w: 12 };

/**
 * 物料分类（物料库左侧分类栏的聚合键）。core 声明与插件贡献共用；
 * 未声明的物料归入库的"全部"，不单列分类。
 */
export const workbenchWidgetCategorySchema = z.enum([
  "agent",
  "analytics",
  "custom",
  "system",
  "vcs",
]);
export type WorkbenchWidgetCategory = z.infer<
  typeof workbenchWidgetCategorySchema
>;

/** @deprecated v1 自动整理兼容字段；v3 响应式有序网格不再消费。 */
export const workbenchWidgetLayoutPrioritySchema = z.enum([
  "primary",
  "normal",
  "secondary",
]);
export type WorkbenchWidgetLayoutPriority = z.infer<
  typeof workbenchWidgetLayoutPrioritySchema
>;

/** @deprecated v1 自动整理兼容字段；v3 响应式有序网格不再消费。 */
export const workbenchWidgetLayoutProfileSchema =
  workbenchGridSizeSchema.extend({
    key: z.string().min(1),
  });
export type WorkbenchWidgetLayoutProfile = z.infer<
  typeof workbenchWidgetLayoutProfileSchema
>;

/**
 * superRefine 校验：按生效值（缺省补齐后）检查 min ≤ default ≤ max 双轴。
 * 违反者 manifest 验证失败——声明不合理应在加载期暴露而非运行期静默 clamp。
 */
function validateWidgetSizeBounds(
  val: {
    defaultSize?: WorkbenchGridSize | undefined;
    layoutProfiles?: WorkbenchWidgetLayoutProfile[] | undefined;
    maxSize?: WorkbenchGridSize | undefined;
    minSize?: WorkbenchGridSize | undefined;
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
  val.layoutProfiles?.forEach((profile, index) => {
    if (
      profile.w < min.w ||
      profile.w > max.w ||
      profile.h < min.h ||
      profile.h > max.h
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `layoutProfiles[${index}] size must stay within minSize/maxSize bounds: ` +
          `min(${min.w}×${min.h}) ≤ profile(${profile.w}×${profile.h}) ≤ max(${max.w}×${max.h})`,
        path: ["layoutProfiles", index],
      });
    }
  });
}

/**
 * manifest 贡献点条目 —— widget 接入规范（尺寸部分）：
 * - defaultSize：添加时的初始尺寸；缺省 HOST_DEFAULT_WIDGET_SIZE = { w: 4, h: 3 }。
 * - minSize：用户调整尺寸与恢复非法历史值时的下限；窄容器内可临时收窄展示。
 * - maxSize：用户调整尺寸与恢复非法历史值时的上限。
 * superRefine 校验（按生效值，即缺省补齐后）：min.w ≤ default.w ≤ max.w 且
 * min.h ≤ default.h ≤ max.h，违反者 manifest 验证失败。缺省 min/max 是所有物料的
 * 兜底边界；layoutPriority/layoutProfiles 仅为旧 manifest 保持解析兼容。
 */
export const pluginWorkbenchWidgetContributionSchema = z
  .object({
    /** 物料库分类；缺省不单列分类（仅"全部"可见）。 */
    category: workbenchWidgetCategorySchema.optional(),
    /** 有设置面板（renderer 注册需同步提供 settingsComponent）。 */
    configurable: z.boolean().optional(),
    defaultSize: workbenchGridSizeSchema.optional(),
    description: z.string().min(1).optional(),
    id: z.string().min(1),
    /** @deprecated v1 兼容字段；响应式有序网格不再按优先级改写用户尺寸。 */
    layoutPriority: workbenchWidgetLayoutPrioritySchema.optional(),
    /** @deprecated v1 兼容字段；响应式有序网格只使用连续 w/h 尺寸偏好。 */
    layoutProfiles: z
      .array(workbenchWidgetLayoutProfileSchema)
      .min(1)
      .optional(),
    maxSize: workbenchGridSizeSchema.optional(),
    minSize: workbenchGridSizeSchema.optional(),
    /** 允许同一工作台内多实例（复制/重复添加）。缺省单实例。 */
    multiInstance: z.boolean().optional(),
    permissions: z.array(pierCapabilitySchema).default([]),
    /** 支持手动刷新（卡片菜单显示"刷新"，refreshToken 递增触发重拉）。 */
    refreshable: z.boolean().optional(),
    /** 物料库搜索词（title/description 之外的补充命中面，与 quick pick 同名语义）。 */
    searchTerms: z.array(z.string().min(1)).optional(),
    title: z.string().min(1),
  })
  .superRefine(validateWidgetSizeBounds);
export type PluginWorkbenchWidgetContribution = z.infer<
  typeof pluginWorkbenchWidgetContributionSchema
>;

/**
 * 工作台单实例组装清单（存 dockview panel params，随 layout 持久化）。
 * 数组顺序是唯一阅读顺序；w/h 是用户尺寸偏好，x/y 由响应式布局临时派生。
 *
 * v3 语义（读取时兼容迁移）：
 * - `id` 是实例 id（多实例物料的新实例用 uuid，单实例物料沿用物料 id）。
 * - `widgetId` 是物料 id；旧条目缺席时回退 `id`（v1 条目 id 即物料 id）。
 * - `params` 是物料私有配置，宿主只保证 JSON 可序列化，不解释内容——
 *   校验责任在物料边界（与插件纪律边界一致）。
 */
export const workbenchPanelWidgetEntrySchema = z.object({
  h: z.number().int().min(1),
  id: z.string().min(1),
  params: z.record(z.string(), jsonValueSchema).optional(),
  w: z.number().int().min(1),
  widgetId: z.string().min(1).optional(),
});
export type WorkbenchPanelWidgetEntry = z.infer<
  typeof workbenchPanelWidgetEntrySchema
>;

export const workbenchPanelParamsSchema = z.object({
  layoutVersion: z.literal(3),
  widgets: z.array(workbenchPanelWidgetEntrySchema),
});
export type WorkbenchPanelParams = z.infer<typeof workbenchPanelParamsSchema>;

const legacyWorkbenchPanelWidgetEntrySchema =
  workbenchPanelWidgetEntrySchema.extend({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  });

/** 条目的物料 id：v2 显式 widgetId，v1 条目回退实例 id（历史上两者同值）。 */
export function widgetEntryWidgetId(entry: {
  id: string;
  widgetId?: string | undefined;
}): string {
  return entry.widgetId ?? entry.id;
}

/**
 * params 逐条抢救：v3 保持数组顺序；旧版按 y/x/原始顺序转换为阅读顺序。
 * 替代"整体 safeParse 失败 → 空数组"——那条路径会让一条脏数据毁掉整个
 * 工作台组装，且用户下一次编辑就把空布局永久写回。
 * 抢救结果只用于渲染，调用方不得主动回写（避免打开面板即触发写盘）。
 */
export function salvageWorkbenchPanelParams(
  raw: unknown
): WorkbenchPanelParams {
  const rawObject =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  const widgetsRaw = rawObject?.widgets;
  if (!Array.isArray(widgetsRaw)) {
    return { layoutVersion: 3, widgets: [] };
  }
  const isCurrent = rawObject?.layoutVersion === 3;
  const parsedWidgets = widgetsRaw.flatMap((entry, sourceIndex) => {
    const parsed = (
      isCurrent
        ? workbenchPanelWidgetEntrySchema
        : legacyWorkbenchPanelWidgetEntrySchema
    ).safeParse(entry);
    return parsed.success ? [{ entry: parsed.data, sourceIndex }] : [];
  });
  if (!isCurrent) {
    parsedWidgets.sort((a, b) => {
      const left = a.entry as z.infer<
        typeof legacyWorkbenchPanelWidgetEntrySchema
      >;
      const right = b.entry as z.infer<
        typeof legacyWorkbenchPanelWidgetEntrySchema
      >;
      return (
        left.y - right.y || left.x - right.x || a.sourceIndex - b.sourceIndex
      );
    });
  }
  return {
    layoutVersion: 3,
    widgets: parsedWidgets.map(({ entry }) => ({
      h: entry.h,
      id: entry.id,
      ...(entry.params ? { params: entry.params } : {}),
      w: entry.w,
      ...(entry.widgetId ? { widgetId: entry.widgetId } : {}),
    })),
  };
}

/**
 * Core-owned widget 静态声明，平行于 CoreTerminalStatusItemDeclaration。
 * 尺寸语义同贡献点；titleKey 走全局 i18next.t 解析。
 * category/searchTerms/multiInstance/configurable/refreshable 语义与插件贡献点一致。
 */
export interface CoreWorkbenchWidgetDeclaration {
  category?: WorkbenchWidgetCategory;
  configurable?: boolean;
  defaultSize: WorkbenchGridSize;
  descriptionKey?: string; // 全局 i18next key（可选副标题）
  id: string; // "core." 前缀
  maxSize: WorkbenchGridSize;
  minSize: WorkbenchGridSize;
  multiInstance?: boolean;
  refreshable?: boolean;
  searchTerms?: readonly string[];
  titleKey: string; // 全局 i18next key
}
