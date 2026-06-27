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
  worktreeSupported: z.boolean().optional(),
});
export type PanelContext = z.infer<typeof panelContextSchema>;

export const panelDisplaySchema = z.object({
  long: z.string().min(1).optional(),
  short: z.string().min(1),
  terminalTitle: z.string().min(1).optional(),
});
export type PanelDisplay = z.infer<typeof panelDisplaySchema>;

export const panelTabIconSchema = z
  .object({
    colorToken: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    uri: z.string().min(1).optional(),
  })
  .strict();
export type PanelTabIcon = z.infer<typeof panelTabIconSchema>;

export const panelTabBadgeSchema = z
  .object({
    colorToken: z.string().min(1).optional(),
    label: z.string().min(1),
  })
  .strict();
export type PanelTabBadge = z.infer<typeof panelTabBadgeSchema>;

export const panelTabStateSchema = z
  .object({
    busy: z.boolean().optional(),
    colorToken: z.string().min(1).optional(),
    icon: panelTabIconSchema.optional(),
    label: z.string().min(1).optional(),
  })
  .strict();
export type PanelTabState = z.infer<typeof panelTabStateSchema>;

export const panelTabTooltipLineSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();
export type PanelTabTooltipLine = z.infer<typeof panelTabTooltipLineSchema>;

export const panelTabTooltipSchema = z
  .object({
    lines: z.array(panelTabTooltipLineSchema).optional(),
    title: z.string().min(1).optional(),
  })
  .strict();
export type PanelTabTooltip = z.infer<typeof panelTabTooltipSchema>;

export const panelTabChromeSchema = z
  .object({
    ariaLabel: z.string().min(1).optional(),
    badge: panelTabBadgeSchema.optional(),
    description: z.string().min(1).optional(),
    icon: panelTabIconSchema.optional(),
    state: panelTabStateSchema.optional(),
    title: z.string().min(1).optional(),
    tooltip: panelTabTooltipSchema.optional(),
  })
  .strict();
export type PanelTabChrome = z.infer<typeof panelTabChromeSchema>;

export const panelDescriptorSchema = z.object({
  context: panelContextSchema.optional(),
  display: panelDisplaySchema,
  tab: panelTabChromeSchema.optional(),
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
  tab: panelTabChromeSchema.optional(),
  tabCount: z.number().int().nonnegative().optional(),
  tabIndex: z.number().int().nonnegative().optional(),
  windowId: z.string().min(1).optional(),
});
export type PanelSnapshot = z.infer<typeof panelSnapshotSchema>;
