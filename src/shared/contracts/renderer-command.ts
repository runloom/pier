import { z } from "zod";
import {
  type PierCommandErrorCode,
  pierCommandPlacementSchema,
} from "./commands.ts";
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
  panelTransferResolvePlacementCommandSchema,
  panelTransferStageTargetCommandSchema,
} from "./panel-transfer.ts";
import { taskPanelMetadataSchema } from "./tasks.ts";

export const rendererCommandSchema = z.discriminatedUnion("type", [
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
  z.object({
    type: z.literal("terminal.open"),
    context: panelContextSchema.optional(),
    focus: z.boolean().optional(),
    initialInput: z.string().min(1).max(64_000).optional(),
    launchId: z.string().min(1),
    panelId: z.string().min(1).optional(),
    placement: pierCommandPlacementSchema.optional(),
    tab: z.preprocess(
      normalizePanelTabChromeInput,
      panelTabChromeSchema.optional()
    ),
    task: taskPanelMetadataSchema.optional(),
    targetGroupId: z.string().min(1).optional(),
    windowId: z.string().min(1).optional(),
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
