import { z } from "zod";
import { pluginInspectRequestSchema } from "./plugin.ts";
import { projectPreferencesSchema } from "./preferences.ts";
import {
  resolvedTerminalLaunchOptionsSchema,
  terminalLaunchOptionsSchema,
} from "./terminal-launch.ts";
import {
  type WorktreeOperationErrorReason,
  worktreeCheckRequestSchema,
  worktreeCreateRequestSchema,
  worktreeListRequestSchema,
  worktreeOpenRequestSchema,
  worktreeRemoveRequestSchema,
} from "./worktree.ts";

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
  z.object({
    type: z.literal("terminal.open"),
    focus: z.boolean().optional(),
    launch: terminalLaunchOptionsSchema.optional(),
    placement: pierCommandPlacementSchema.optional(),
    windowId: z.string().min(1).optional(),
  }),
  z.object({
    projectRoot: z.string().min(1),
    type: z.literal("run.list"),
  }),
  z.object({
    focus: z.boolean().optional(),
    inputs: z.record(z.string().min(1), z.string()).optional(),
    placement: pierCommandPlacementSchema.optional(),
    projectRoot: z.string().min(1),
    taskId: z.string().min(1),
    type: z.literal("run.spawn"),
  }),
  z.object({ type: z.literal("terminal.profile.list") }),
  z.object({
    type: z.literal("terminal.profile.read"),
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal("terminal.profile.upsert"),
    profile: resolvedTerminalLaunchOptionsSchema,
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal("terminal.profile.delete"),
    profileId: z.string().min(1),
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
  worktreeListRequestSchema.extend({
    type: z.literal("worktree.list"),
  }),
  worktreeCheckRequestSchema.extend({
    type: z.literal("worktree.check"),
  }),
  worktreeCreateRequestSchema.extend({
    type: z.literal("worktree.create"),
  }),
  worktreeOpenRequestSchema.extend({
    focus: z.boolean().optional(),
    placement: pierCommandPlacementSchema.optional(),
    type: z.literal("worktree.open"),
    windowId: z.string().min(1).optional(),
  }),
  worktreeRemoveRequestSchema.extend({
    type: z.literal("worktree.remove"),
  }),
  z.object({ type: z.literal("plugin.list") }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.inspect"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.enable"),
  }),
  pluginInspectRequestSchema.extend({
    type: z.literal("plugin.disable"),
  }),
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
  | "unsupported"
  | "internal_error"
  | WorktreeOperationErrorReason;

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
