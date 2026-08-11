/**
 * W4 宿主原语扩展：terminal list/get/send/key、run.output/rerun、app.snapshot。
 * 并入 pierCommandSchema；不新增 files/git 命令组。
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
] as const;
