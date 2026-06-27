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

export const panelTabStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "blocked",
  "succeeded",
  "failed",
]);
export type PanelTabStatus = z.infer<typeof panelTabStatusSchema>;

export const panelTabStateSchema = z
  .object({
    colorToken: z.string().min(1).optional(),
    icon: panelTabIconSchema.optional(),
    label: z.string().min(1).optional(),
    status: panelTabStatusSchema.optional(),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function legacyStatusFromState(
  state: Record<string, unknown>
): PanelTabStatus | undefined {
  const canonical = panelTabStatusSchema.safeParse(state.status);
  if (canonical.success) {
    return canonical.data;
  }

  if (state.busy === true) {
    return "running";
  }
  if (state.busy !== false) {
    return;
  }

  if (state.colorToken === "success") {
    return "succeeded";
  }
  if (
    state.colorToken === "destructive" ||
    (typeof state.label === "string" && state.label.startsWith("Failed"))
  ) {
    return "failed";
  }
  return "idle";
}

function normalizePanelTabStateInput(state: unknown): unknown {
  if (!isRecord(state)) {
    return state;
  }
  const { busy: _legacyBusy, ...stateWithoutBusy } = state;
  const status = legacyStatusFromState(state);
  return status
    ? {
        ...stateWithoutBusy,
        status,
      }
    : stateWithoutBusy;
}

export function normalizePanelTabChromeInput(
  input: unknown
): PanelTabChrome | undefined {
  if (!isRecord(input)) {
    return;
  }
  const normalized = {
    ...input,
    ...("state" in input
      ? { state: normalizePanelTabStateInput(input.state) }
      : {}),
  };
  const parsed = panelTabChromeSchema.safeParse(normalized);
  return parsed.success ? parsed.data : undefined;
}

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
