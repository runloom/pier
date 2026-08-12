/**
 * 宿主原语扩展：terminal / run / app.snapshot（W4）+ notifications.*（W5）。
 * 并入 pierCommandSchema；不新增 files/git / activity 命令组。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const hostControlCommandSchemas = [
  z.object({
    type: z.literal("terminal.list"),
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("terminal.get"),
    panelId: nonEmpty,
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("terminal.send"),
    panelId: nonEmpty,
    text: z.string().min(1).max(1_048_576),
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("terminal.key"),
    panelId: nonEmpty,
    /** 简化键名：enter | escape | tab | ctrl-c | 或单字符 */
    key: nonEmpty.max(32),
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("run.output"),
    runId: nonEmpty,
    taskId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("run.rerun"),
    runId: nonEmpty,
    focus: z.boolean().optional(),
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("app.snapshot"),
    /** 可选 scope 提示；实现以全量高水位为主 */
    scope: nonEmpty.optional(),
  }),
  // W5-S2：notifications CLI — 只经 NCS；不改 runtime / 调用方结论
  z.object({
    type: z.literal("notifications.list"),
    unreadOnly: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("notifications.get"),
    id: nonEmpty.max(64),
  }),
  z.object({
    type: z.literal("notifications.watch"),
    /** NCS snapshot.seq；缺省先回当前快照 */
    after: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    pollMs: z.number().int().positive().max(60_000).optional(),
  }),
  z.object({
    type: z.literal("notifications.focus"),
    id: nonEmpty.max(64),
  }),
  z
    .object({
      type: z.literal("notifications.mark-read"),
      id: nonEmpty.max(64).optional(),
      all: z.boolean().optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const hasId = typeof value.id === "string" && value.id.length > 0;
      const hasAll = value.all === true;
      if (hasId === hasAll) {
        ctx.addIssue({
          code: "custom",
          message: "notifications.mark-read requires exactly one of id or all",
        });
      }
    }),
] as const;
