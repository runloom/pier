import { z } from "zod";
import {
  type PierCommandErrorCode,
  pierCommandPlacementSchema,
} from "./commands.ts";
import { terminalExitPresentationSchema } from "./ghostty-host-copy.ts";
import {
  normalizePanelTabChromeInput,
  panelContextSchema,
  panelTabChromeSchema,
} from "./panel.ts";
import {
  panelTransferFinalizeCommandSchema,
  panelTransferPrepareSourceCommandSchema,
  panelTransferProbeWorkspaceCommandSchema,
  panelTransferReleaseSourceCommandSchema,
  panelTransferResolveDefaultPlacementCommandSchema,
  panelTransferResolvePlacementCommandSchema,
  panelTransferStageTargetCommandSchema,
} from "./panel-transfer.ts";
import { taskPanelMetadataSchema } from "./tasks.ts";

export const rendererCommandSchema = z.discriminatedUnion("type", [
  z.object({
    command: z.string().min(1).max(8192),
    intent: z.enum(["default", "destructive"]),
    type: z.literal("dialog.confirm"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("panel.list"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("panel.focus"),
    focus: z.boolean().optional(),
    panelId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  }),
  z
    .object({
      heightRatio: z.number().gt(0).lt(1).optional(),
      panelId: z.string().min(1),
      type: z.literal("panel.setSize"),
      widthRatio: z.number().gt(0).lt(1).optional(),
      windowId: z.string().min(1).optional(),
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
    panelIds: z.array(z.string().min(1)).min(1),
    type: z.literal("panel.equalize"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("panel.close"),
    panelId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("panel.open"),
    context: panelContextSchema,
    focus: z.boolean().optional(),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z
    .object({
      type: z.literal("terminal.open"),
      /** 后台创建：跳过可见性门控，挂载即建面（agents.start 委派路径）。 */
      backgroundCreate: z.boolean().optional(),
      context: panelContextSchema.optional(),
      exitPresentation: terminalExitPresentationSchema.optional(),
      focus: z.boolean().optional(),
      initialInput: z.string().min(1).max(64_000).optional(),
      initialInputSubmit: z.boolean().optional(),
      launchId: z.string().min(1),
      panelId: z.string().min(1).optional(),
      placement: pierCommandPlacementSchema.optional(),
      /** 相对分屏锚点；与 `panelId`（复用/重开）互斥。 */
      referencePanelId: z.string().min(1).optional(),
      tab: z.preprocess(
        normalizePanelTabChromeInput,
        panelTabChromeSchema.optional()
      ),
      task: taskPanelMetadataSchema.optional(),
      targetGroupId: z.string().min(1).optional(),
      windowId: z.string().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.panelId && value.referencePanelId) {
        ctx.addIssue({
          code: "custom",
          message: "terminal.open cannot combine panelId and referencePanelId",
        });
      }
    }),
  z.object({
    type: z.literal("workspace.flushLayout"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    body: z.string().min(1),
    type: z.literal("workspace.reportCloseFailure"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    reason: z.enum(["app-quit", "window-close"]),
    transitionId: z.string().min(1),
    type: z.literal("workspace.prepareClose"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    outcome: z.enum(["abort", "commit"]),
    transitionId: z.string().min(1),
    type: z.literal("workspace.finalizeClose"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    generation: z.number().int().positive(),
    pluginId: z.string().min(1),
    transitionId: z.string().min(1),
    type: z.literal("plugin.prepareDisable"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    generation: z.number().int().positive(),
    outcome: z.enum(["abort", "commit"]),
    pluginId: z.string().min(1),
    transitionId: z.string().min(1),
    type: z.literal("plugin.finalizeDisable"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    generation: z.number().int().positive(),
    pluginId: z.string().min(1),
    transitionId: z.string().min(1),
    type: z.literal("plugin.prepareReload"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    generation: z.number().int().positive(),
    outcome: z.enum(["abort", "commit"]),
    pluginId: z.string().min(1),
    transitionId: z.string().min(1),
    type: z.literal("plugin.finalizeReload"),
    windowId: z.string().min(1).optional(),
  }),
  panelTransferPrepareSourceCommandSchema,
  panelTransferStageTargetCommandSchema,
  panelTransferReleaseSourceCommandSchema,
  panelTransferFinalizeCommandSchema,
  panelTransferResolvePlacementCommandSchema,
  panelTransferResolveDefaultPlacementCommandSchema,
  panelTransferProbeWorkspaceCommandSchema,
]);

export type RendererCommand = z.infer<typeof rendererCommandSchema>;

export const rendererCommandEnvelopeSchema = z.object({
  command: rendererCommandSchema,
  requestId: z.string().min(1),
});

export type RendererCommandEnvelope = z.infer<
  typeof rendererCommandEnvelopeSchema
>;

export type RendererCommandResult =
  | {
      data: unknown;
      ok: true;
      requestId: string;
    }
  | {
      error: {
        code?: PierCommandErrorCode | undefined;
        message: string;
      };
      ok: false;
      requestId: string;
    };
