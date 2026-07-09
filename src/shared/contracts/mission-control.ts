import type { RefinementCtx } from "zod";
import { z } from "zod";
import { pierCapabilitySchema } from "./permissions.ts";
import { jsonValueSchema } from "./plugin-settings.ts";

/** 指挥中心网格列数。契约级常量：w/x 的取值域由它决定。 */
export const MISSION_CONTROL_GRID_COLS = 12;

/** 网格尺寸（单位：格）。 */
export const missionControlGridSizeSchema = z.object({
  h: z.number().int().min(1).max(24),
  w: z.number().int().min(1).max(MISSION_CONTROL_GRID_COLS),
});
export type MissionControlGridSize = z.infer<
  typeof missionControlGridSizeSchema
>;

/** 尺寸缺省值（契约级，宿主与校验共用同一真相源）。 */
export const HOST_DEFAULT_WIDGET_SIZE: MissionControlGridSize = { h: 3, w: 4 };
export const HOST_MIN_WIDGET_SIZE: MissionControlGridSize = { h: 2, w: 2 };
export const HOST_MAX_WIDGET_SIZE: MissionControlGridSize = { h: 12, w: 12 };

/**
 * 物料分类（物料库左侧分类栏的聚合键）。core 声明与插件贡献共用；
 * 未声明的物料归入库的"全部"，不单列分类。
 */
export const missionControlWidgetCategorySchema = z.enum([
  "agent",
  "analytics",
  "custom",
  "system",
  "vcs",
]);
export type MissionControlWidgetCategory = z.infer<
  typeof missionControlWidgetCategorySchema
>;

/** 自动布局优先级：高优先级物料在同等条件下优先获得额外宽度。 */
export const missionControlWidgetLayoutPrioritySchema = z.enum([
  "primary",
  "normal",
  "secondary",
]);
export type MissionControlWidgetLayoutPriority = z.infer<
  typeof missionControlWidgetLayoutPrioritySchema
>;

/** 自动布局候选尺寸：声明经过物料设计验证的可用档位。 */
export const missionControlWidgetLayoutProfileSchema =
  missionControlGridSizeSchema.extend({
    key: z.string().min(1),
  });
export type MissionControlWidgetLayoutProfile = z.infer<
  typeof missionControlWidgetLayoutProfileSchema
>;

/**
 * superRefine 校验：按生效值（缺省补齐后）检查 min ≤ default ≤ max 双轴。
 * 违反者 manifest 验证失败——声明不合理应在加载期暴露而非运行期静默 clamp。
 */
function validateWidgetSizeBounds(
  val: {
    defaultSize?: MissionControlGridSize | undefined;
    layoutProfiles?: MissionControlWidgetLayoutProfile[] | undefined;
    maxSize?: MissionControlGridSize | undefined;
    minSize?: MissionControlGridSize | undefined;
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
 * - minSize：尺寸下限；显式声明时表示物料启用自动尺寸，窄容器可缩到该尺寸。
 * - maxSize：尺寸上限；显式声明时表示物料启用自动尺寸，宽容器最多放大到该尺寸。
 * superRefine 校验（按生效值，即缺省补齐后）：min.w ≤ default.w ≤ max.w 且
 * min.h ≤ default.h ≤ max.h，违反者 manifest 验证失败。缺省 min/max 只作为
 * schema 兜底参与校验；自动尺寸由显式 minSize / maxSize 声明触发。
 */
export const pluginMissionControlWidgetContributionSchema = z
  .object({
    /** 物料库分类；缺省不单列分类（仅"全部"可见）。 */
    category: missionControlWidgetCategorySchema.optional(),
    /** 有设置面板（renderer 注册需同步提供 settingsComponent）。 */
    configurable: z.boolean().optional(),
    defaultSize: missionControlGridSizeSchema.optional(),
    description: z.string().min(1).optional(),
    id: z.string().min(1),
    layoutPriority: missionControlWidgetLayoutPrioritySchema.optional(),
    layoutProfiles: z
      .array(missionControlWidgetLayoutProfileSchema)
      .min(1)
      .optional(),
    maxSize: missionControlGridSizeSchema.optional(),
    minSize: missionControlGridSizeSchema.optional(),
    /** 允许同一指挥中心内多实例（复制/重复添加）。缺省单实例。 */
    multiInstance: z.boolean().optional(),
    permissions: z.array(pierCapabilitySchema).default([]),
    /** 支持手动刷新（卡片菜单显示"刷新"，refreshToken 递增触发重拉）。 */
    refreshable: z.boolean().optional(),
    /** 物料库搜索词（title/description 之外的补充命中面，与 quick pick 同名语义）。 */
    searchTerms: z.array(z.string().min(1)).optional(),
    title: z.string().min(1),
  })
  .superRefine(validateWidgetSizeBounds);
export type PluginMissionControlWidgetContribution = z.infer<
  typeof pluginMissionControlWidgetContributionSchema
>;

/**
 * 指挥中心单实例组装清单（存 dockview panel params，随 layout 持久化）。
 * 每项即 react-grid-layout 的一个 layout item（i=id，x/y/w/h 同义直存）。
 *
 * v2 语义（零迁移）：
 * - `id` 是实例 id（多实例物料的新实例用 uuid，单实例物料沿用物料 id）。
 * - `widgetId` 是物料 id；旧条目缺席时回退 `id`（v1 条目 id 即物料 id）。
 * - `params` 是物料私有配置，宿主只保证 JSON 可序列化，不解释内容——
 *   校验责任在物料边界（与插件纪律边界一致）。
 */
export const missionControlPanelWidgetEntrySchema = z.object({
  h: z.number().int().min(1),
  id: z.string().min(1),
  params: z.record(z.string(), jsonValueSchema).optional(),
  w: z.number().int().min(1).max(MISSION_CONTROL_GRID_COLS),
  widgetId: z.string().min(1).optional(),
  x: z
    .number()
    .int()
    .min(0)
    .max(MISSION_CONTROL_GRID_COLS - 1),
  y: z.number().int().min(0),
});
export type MissionControlPanelWidgetEntry = z.infer<
  typeof missionControlPanelWidgetEntrySchema
>;

export const missionControlPanelParamsSchema = z.object({
  /** 锁定布局：拖拽/resize/添加/移除禁用，只读消费。缺省不锁定。 */
  locked: z.boolean().optional(),
  widgets: z.array(missionControlPanelWidgetEntrySchema),
});
export type MissionControlPanelParams = z.infer<
  typeof missionControlPanelParamsSchema
>;

/** 条目的物料 id：v2 显式 widgetId，v1 条目回退实例 id（历史上两者同值）。 */
export function widgetEntryWidgetId(entry: {
  id: string;
  widgetId?: string | undefined;
}): string {
  return entry.widgetId ?? entry.id;
}

/**
 * params 逐条抢救：整体合法直接返回；否则逐条校验，丢非法项、留合法项。
 * 替代"整体 safeParse 失败 → 空数组"——那条路径会让一条脏数据毁掉整个
 * 指挥中心组装，且用户下一次编辑就把空布局永久写回。
 * 抢救结果只用于渲染，调用方不得主动回写（避免打开面板即触发写盘）。
 */
export function salvageMissionControlPanelParams(
  raw: unknown
): MissionControlPanelParams {
  const full = missionControlPanelParamsSchema.safeParse(raw);
  if (full.success) {
    return full.data;
  }
  const rawObject =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  const locked = typeof rawObject?.locked === "boolean" && rawObject.locked;
  const widgetsRaw = rawObject?.widgets;
  if (!Array.isArray(widgetsRaw)) {
    return { widgets: [], ...(locked ? { locked } : {}) };
  }
  const widgets = widgetsRaw.flatMap((entry) => {
    const parsed = missionControlPanelWidgetEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { widgets, ...(locked ? { locked } : {}) };
}

/**
 * Core-owned widget 静态声明，平行于 CoreTerminalStatusItemDeclaration。
 * 尺寸语义同贡献点；titleKey 走全局 i18next.t 解析。
 * category/searchTerms/multiInstance/configurable/refreshable 语义与插件贡献点一致。
 */
export interface CoreMissionControlWidgetDeclaration {
  category?: MissionControlWidgetCategory;
  configurable?: boolean;
  defaultSize?: MissionControlGridSize;
  descriptionKey?: string; // 全局 i18next key（可选副标题）
  id: string; // "core." 前缀
  layoutPriority?: MissionControlWidgetLayoutPriority;
  layoutProfiles?: readonly MissionControlWidgetLayoutProfile[];
  maxSize?: MissionControlGridSize;
  minSize?: MissionControlGridSize;
  multiInstance?: boolean;
  refreshable?: boolean;
  searchTerms?: readonly string[];
  titleKey: string; // 全局 i18next key
}
