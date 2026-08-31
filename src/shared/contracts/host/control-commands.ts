/**
 * 宿主原语扩展：terminal / run / app.snapshot（W4）+ notifications.*（W5）。
 * 并入 pierCommandSchema；不新增 files/git / activity 命令组。
 */
import { z } from "zod";
import { HOOK_WORK_ID_MAX } from "../agent/session.ts";
import {
  terminalScreenMaxBytesSchema,
  terminalScreenMaxLinesSchema,
} from "../terminal/screen.ts";

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
    type: z.literal("terminal.screen"),
    maxBytes: terminalScreenMaxBytesSchema.optional(),
    maxLines: terminalScreenMaxLinesSchema.optional(),
    panelId: nonEmpty,
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("terminal.read"),
    maxBytes: terminalScreenMaxBytesSchema.optional(),
    maxLines: terminalScreenMaxLinesSchema.optional(),
    panelId: nonEmpty,
    windowId: nonEmpty.optional(),
  }),
  z.object({
    type: z.literal("terminal.close"),
    panelId: nonEmpty,
    windowId: nonEmpty.optional(),
  }),
  z
    .object({
      heightRatio: z.number().gt(0).lt(1).optional(),
      panelId: nonEmpty,
      type: z.literal("panel.setSize"),
      widthRatio: z.number().gt(0).lt(1).optional(),
      windowId: nonEmpty.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.widthRatio === undefined && value.heightRatio === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "panel.setSize requires widthRatio and/or heightRatio",
        });
      }
    }),
  z.object({
    axis: z.enum(["horizontal", "vertical"]),
    panelIds: z.array(nonEmpty).min(1),
    type: z.literal("panel.equalize"),
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
  // M2：Web 壳推送句柄（仅 mobile-paired）。deviceId 由会话身份决定，
  // 不入参——防止伪造他机句柄（规格 §12 / M2 计划 Task 8）。
  z.object({ type: z.literal("notifications.getPushPublicKey") }).strict(),
  z
    .object({
      type: z.literal("notifications.registerPushHandle"),
      webPush: z
        .object({
          endpoint: z.string().url(),
          keys: z.object({ p256dh: nonEmpty, auth: nonEmpty }).strict(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("notifications.unregisterPushHandle") }).strict(),
  // M1：移动端审批回写。只允许 13 个固定审批键的按键字节，不开任意文本。
  // 语义动作（approve/reject 映射表）待证据矩阵——未验证一律 unsupported，
  // schema 不含语义动作字段，UI 不出现语义按钮。
  // agentRef 两形态：完整引用（桌面）或裸 panelId（移动端面板寻址，
  // 宿主解析当前窗口；窗口概念不出宿主）。
  z
    .object({
      type: z.literal("agent.attention.respond"),
      agentRef: nonEmpty,
      interactionId: nonEmpty.max(HOOK_WORK_ID_MAX),
      key: z.enum([
        "enter",
        "escape",
        "y",
        "n",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
      ]),
    })
    .strict(),
  // M1：宿主远程访问管理命令面（Task 9）。仅 desktop-renderer；
  // 能力 remote-access:read（getState）/ remote-access:control（其余四条）。
  z
    .object({
      type: z.literal("remoteAccess.getState"),
    })
    .strict(),
  z
    .object({
      type: z.literal("remoteAccess.setEnabled"),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remoteAccess.beginPairing"),
    })
    .strict(),
  z
    .object({
      type: z.literal("remoteAccess.cancelPairing"),
    })
    .strict(),
  z
    .object({
      type: z.literal("remoteAccess.revokeDevice"),
      deviceId: nonEmpty,
    })
    .strict(),
] as const;
