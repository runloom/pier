import { z } from "zod";
import { projectPreferencesSchema } from "./preferences.ts";

export const pierProtocolVersionSchema = z.literal(1);
export type PierProtocolVersion = z.infer<typeof pierProtocolVersionSchema>;

export const projectPreferencesPatchSchema = projectPreferencesSchema.partial();
export type ProjectPreferencesPatch = z.infer<
  typeof projectPreferencesPatchSchema
>;

export const pierCommandPlacementSchema = z.enum([
  "active-tab",
  "split-right",
  "split-below",
  "split-left",
  "split-above",
]);
export type PierCommandPlacement = z.infer<typeof pierCommandPlacementSchema>;

export const pierCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app.status") }),
  z.object({ type: z.literal("preferences.read") }),
  z.object({
    type: z.literal("preferences.update"),
    patch: projectPreferencesPatchSchema,
  }),
  z.object({
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.read"),
  }),
  z.object({
    layout: z.unknown(),
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.save"),
  }),
  z.object({
    recordId: z.string().min(1),
    type: z.literal("workspace.layout.clear"),
  }),
  z.object({
    type: z.literal("panel.open"),
    focus: z.boolean().optional(),
    path: z.string().min(1),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("window.list") }),
  z.object({ type: z.literal("window.create") }),
  z.object({
    type: z.literal("window.focus"),
    windowId: z.string().min(1),
  }),
  z.object({
    type: z.literal("window.close"),
    windowId: z.string().min(1),
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
  z.object({ type: z.literal("commandPaletteMru.read") }),
  z.object({
    type: z.literal("commandPaletteMru.record"),
    actionId: z.string().min(1).max(128),
  }),
  z.object({ type: z.literal("commandPaletteMru.clear") }),
]);

export type PierCommand = z.infer<typeof pierCommandSchema>;

export const pierCommandEnvelopeSchema = z.object({
  protocolVersion: pierProtocolVersionSchema,
  requestId: z.string().min(1),
  clientId: z.string().min(1),
  command: pierCommandSchema,
});

export type PierCommandEnvelope = z.infer<typeof pierCommandEnvelopeSchema>;

export type PierCommandErrorCode =
  | "invalid_command"
  | "permission_denied"
  | "not_found"
  | "platform_unavailable"
  | "internal_error";

export type PierCommandResult =
  | { data: unknown; ok: true; requestId: string }
  | {
      error: {
        code: PierCommandErrorCode;
        message: string;
      };
      ok: false;
      requestId: string;
    };
