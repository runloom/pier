/**
 * 终端状态栏用户覆盖契约 — main L1 terminal-status-bar-prefs.json、PierCommand
 * envelope 与 renderer 镜像 store 共用。
 *
 * 生效值合并链固定为:用户覆盖 ?? manifest 声明 ?? 默认(alignment "left"、
 * order 0、可见)。只存用户显式覆盖过的值;「恢复默认」= 删除该 itemId 的 key。
 */
import { z } from "zod";
import { terminalStatusItemAlignmentSchema } from "./plugin.ts";

export const terminalStatusBarItemOverrideSchema = z.object({
  alignment: terminalStatusItemAlignmentSchema.optional(),
  hidden: z.boolean().optional(),
  order: z.number().optional(),
});
export type TerminalStatusBarItemOverride = z.infer<
  typeof terminalStatusBarItemOverrideSchema
>;

export const terminalStatusBarPrefsSchema = z.object({
  items: z.record(z.string().min(1), terminalStatusBarItemOverrideSchema),
  version: z.literal(1),
});
export type TerminalStatusBarPrefs = z.infer<
  typeof terminalStatusBarPrefsSchema
>;

export function emptyTerminalStatusBarPrefs(): TerminalStatusBarPrefs {
  return { items: {}, version: 1 };
}

/** patch 字段语义:值 → 设置;null → 清除该字段;缺省 → 保留现值。 */
export interface TerminalStatusBarItemOverridePatch {
  alignment?: "left" | "right" | null;
  hidden?: boolean | null;
  order?: number | null;
}

/**
 * 以 patch 合成下一个 override。全部字段清空时返回 null —— 调用方应改走
 * resetItem(从 items 删除该 key),与「只存显式覆盖」的存储原则一致。
 */
export function withItemOverridePatch(
  current: TerminalStatusBarItemOverride | undefined,
  patch: TerminalStatusBarItemOverridePatch
): TerminalStatusBarItemOverride | null {
  const alignment = "alignment" in patch ? patch.alignment : current?.alignment;
  const hidden = "hidden" in patch ? patch.hidden : current?.hidden;
  const order = "order" in patch ? patch.order : current?.order;
  const next: TerminalStatusBarItemOverride = {};
  if (alignment !== null && alignment !== undefined) {
    next.alignment = alignment;
  }
  if (hidden !== null && hidden !== undefined) {
    next.hidden = hidden;
  }
  if (order !== null && order !== undefined) {
    next.order = order;
  }
  return Object.keys(next).length > 0 ? next : null;
}
