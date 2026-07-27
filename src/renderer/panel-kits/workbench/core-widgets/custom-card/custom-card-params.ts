import type { WidgetDensity } from "@pier/ui/collection-auto-layout.ts";
import { z } from "zod";
import type { MetricDescriptor } from "@/lib/workbench/metric-registry.ts";

/**
 * "自定义卡片"物料的 params 契约。宿主视 params 为黑盒——
 * 校验收敛在本物料边界，非法区块逐条丢弃（对齐 salvage 哲学）。
 */

export const customCardBlockTypeSchema = z.enum([
  "gauge",
  "kpi",
  "ranking",
  "trend",
]);
export type CustomCardBlockType = z.infer<typeof customCardBlockTypeSchema>;

export const customCardBlockSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  metricId: z.string().min(1),
  type: customCardBlockTypeSchema,
});
export type CustomCardBlock = z.infer<typeof customCardBlockSchema>;

export interface CustomCardParams {
  blocks: CustomCardBlock[];
}

export function parseCustomCardParams(
  raw: Readonly<Record<string, unknown>>
): CustomCardParams {
  const blocksRaw = raw.blocks;
  if (!Array.isArray(blocksRaw)) {
    return { blocks: [] };
  }
  return {
    blocks: blocksRaw.flatMap((block) => {
      const parsed = customCardBlockSchema.safeParse(block);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

/**
 * 区块 × 指标兼容矩阵：kpi 吃即时值，gauge 只吃 percent 即时值
 * （无上限语义的 bytes/count 画不出有意义的进度），trend 吃序列，
 * ranking 吃分组。
 */
export function blockAcceptsMetric(
  type: CustomCardBlockType,
  descriptor: MetricDescriptor
): boolean {
  switch (type) {
    case "gauge":
      return descriptor.kind === "instant" && descriptor.format === "percent";
    case "kpi":
      return descriptor.kind === "instant";
    case "ranking":
      return descriptor.kind === "grouped";
    case "trend":
      return descriptor.kind === "series";
    default:
      return false;
  }
}

/** compact 只留 kpi/gauge；medium 省略 trend；full 全开。 */
export function blockVisibleAtDensity(
  type: CustomCardBlockType,
  density: WidgetDensity
): boolean {
  switch (density) {
    case "compact":
      return type === "kpi" || type === "gauge";
    case "full":
      return true;
    case "medium":
      return type !== "trend";
    default:
      return true;
  }
}

/** ranking 条数上限：compact 0、medium 4/6、full 6/10。 */
export function rankingLimitForDensity(
  density: WidgetDensity,
  height: number
): number {
  if (density === "compact") return 0;
  if (density === "medium") return height <= 3 ? 4 : 6;
  return height >= 5 ? 10 : 6;
}

/** 轻量块（kpi/gauge）聚组成 auto-fit 网格，重量块（trend/ranking）各占满宽行。保留原始顺序。 */
export function groupBlocks(
  blocks: readonly CustomCardBlock[]
): readonly (
  | { blocks: readonly CustomCardBlock[]; kind: "compact" }
  | { block: CustomCardBlock; kind: "full" }
)[] {
  const groups: (
    | { blocks: readonly CustomCardBlock[]; kind: "compact" }
    | { block: CustomCardBlock; kind: "full" }
  )[] = [];
  let run: CustomCardBlock[] = [];
  const flushRun = (): void => {
    if (run.length > 0) {
      groups.push({ blocks: run, kind: "compact" });
      run = [];
    }
  };
  for (const block of blocks) {
    if (block.type === "kpi" || block.type === "gauge") {
      run.push(block);
    } else {
      flushRun();
      groups.push({ block, kind: "full" });
    }
  }
  flushRun();
  return groups;
}
