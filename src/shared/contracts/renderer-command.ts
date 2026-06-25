import { z } from "zod";
import { pierCommandPlacementSchema } from "./commands.ts";

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
    type: z.literal("terminal.list"),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("terminal.open"),
    focus: z.boolean().optional(),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("terminal.focus"),
    focus: z.boolean().optional(),
    panelId: z.string().min(1),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("workspace.open"),
    focus: z.boolean().optional(),
    path: z.string().min(1),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("workspace.flushLayout"),
    windowId: z.string().min(1).optional(),
  }),
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
        message: string;
      };
      ok: false;
      requestId: string;
    };
