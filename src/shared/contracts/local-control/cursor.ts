/**
 * Control cursor 命名空间与 after 形状（W6-S5）。
 * 跨 scope resume 禁止；与 design §8 / gold E11 对齐。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

/** 顶层 control.watch / subscribe global */
export const CONTROL_CURSOR_SCOPE_GLOBAL = "global" as const;
/** agents wait/watch 运行事实流 */
export const CONTROL_CURSOR_SCOPE_AGENTS_RUNTIME = "agents.runtime" as const;
/** notifications.watch */
export const CONTROL_CURSOR_SCOPE_NOTIFICATIONS = "notifications" as const;
/** v2 subscribe 便利流 */
export const CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS = "resource:agents" as const;
export const CONTROL_CURSOR_SCOPE_RESOURCE_ACTIVITY =
  "resource:activity" as const;

export const CONTROL_CURSOR_SCOPES = [
  CONTROL_CURSOR_SCOPE_GLOBAL,
  CONTROL_CURSOR_SCOPE_AGENTS_RUNTIME,
  CONTROL_CURSOR_SCOPE_NOTIFICATIONS,
  CONTROL_CURSOR_SCOPE_RESOURCE_AGENTS,
  CONTROL_CURSOR_SCOPE_RESOURCE_ACTIVITY,
] as const;

export type ControlCursorScope = (typeof CONTROL_CURSOR_SCOPES)[number];

export const controlCursorScopeSchema = z.enum(CONTROL_CURSOR_SCOPES);

/**
 * 结构化 after（与 v2 subscribe.after 同构）。
 * bootId 可省略：会话层填当前 boot（本机 CLI `--after <rev>` 便利）。
 */
export const controlCursorAfterObjectSchema = z
  .object({
    bootId: nonEmpty.optional(),
    revision: z.number().int().nonnegative(),
    scope: controlCursorScopeSchema.optional(),
  })
  .strict();

export type ControlCursorAfterObject = z.infer<
  typeof controlCursorAfterObjectSchema
>;

/**
 * 兼容：历史 `after: number` = 仅 revision（scope/boot 由 op 默认）。
 * 新客户端应传对象。
 */
export const controlCursorAfterSchema = z.union([
  z.number().int().nonnegative(),
  controlCursorAfterObjectSchema,
]);

export type ControlCursorAfter = z.infer<typeof controlCursorAfterSchema>;

export interface NormalizedControlCursorAfter {
  bootId: string | undefined;
  revision: number;
  scope: ControlCursorScope | undefined;
}

/** 将 number | object 规范为对象字段（不填默认 scope/boot）。 */
export function normalizeControlCursorAfter(
  after: ControlCursorAfter
): NormalizedControlCursorAfter {
  if (typeof after === "number") {
    return { bootId: undefined, revision: after, scope: undefined };
  }
  return {
    bootId: after.bootId,
    revision: after.revision,
    scope: after.scope,
  };
}
