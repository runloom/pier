import { z } from "zod";

export const panelKindSchema = z.enum([
  "terminal",
  "web",
  "file",
  "diff",
  "agent",
  "custom",
]);
export type PanelKind = z.infer<typeof panelKindSchema>;

export const panelContextSourceSchema = z.enum([
  "cli",
  "command",
  "restore",
  "panel",
]);
export type PanelContextSource = z.infer<typeof panelContextSourceSchema>;

export const panelContextSchema = z.object({
  branch: z.string().min(1).optional(),
  contextId: z.string().min(1),
  cwd: z.string().min(1).optional(),
  gitCommonDir: z.string().min(1).optional(),
  gitRoot: z.string().min(1).optional(),
  head: z.string().min(1).optional(),
  openedPath: z.string().min(1).optional(),
  projectRoot: z.string().min(1).optional(),
  source: panelContextSourceSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
  worktreeKey: z.string().min(1).optional(),
  worktreeRoot: z.string().min(1).optional(),
});
export type PanelContext = z.infer<typeof panelContextSchema>;

export const panelDisplaySchema = z.object({
  long: z.string().min(1).optional(),
  short: z.string().min(1),
  terminalTitle: z.string().min(1).optional(),
});
export type PanelDisplay = z.infer<typeof panelDisplaySchema>;

export const panelDescriptorSchema = z.object({
  context: panelContextSchema.optional(),
  display: panelDisplaySchema,
});
export type PanelDescriptor = z.infer<typeof panelDescriptorSchema>;

export const panelSnapshotSchema = z.object({
  active: z.boolean().optional(),
  context: panelContextSchema.optional(),
  display: panelDisplaySchema.optional(),
  groupIndex: z.number().int().nonnegative().optional(),
  id: z.string().min(1),
  kind: panelKindSchema,
  recordId: z.string().min(1).optional(),
  tabCount: z.number().int().nonnegative().optional(),
  tabIndex: z.number().int().nonnegative().optional(),
  windowId: z.string().min(1).optional(),
});
export type PanelSnapshot = z.infer<typeof panelSnapshotSchema>;
