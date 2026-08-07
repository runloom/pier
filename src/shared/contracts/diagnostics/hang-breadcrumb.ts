import { z } from "zod";

/**
 * Always-on hang trail (incident 837a5749fc11).
 * Renderer batches crumbs; main writes diagnostics JSONL + ring buffer.
 * Strict / capped so a busy UI cannot flood disk or IPC.
 */

export const HANG_BREADCRUMB_PATH_MAX = 200;
export const HANG_BREADCRUMB_DETAIL_MAX = 120;
export const HANG_BREADCRUMB_PANEL_ID_MAX = 160;
export const HANG_BREADCRUMB_COMMAND_ID_MAX = 160;
export const HANG_BREADCRUMB_COMPONENT_MAX = 80;

/**
 * Must match main diagnostics `MAX_ARRAY_ITEMS` so unresponsive dumps do not
 * keep the oldest crumbs and drop the newest.
 */
export const HANG_BREADCRUMB_DIAGNOSTICS_MAX = 100;

const shortId = z.string().min(1).max(HANG_BREADCRUMB_COMMAND_ID_MAX);
const shortLabel = z.string().min(1).max(HANG_BREADCRUMB_DETAIL_MAX);
const pathHint = z.string().min(1).max(HANG_BREADCRUMB_PATH_MAX);

/**
 * Keep the most informative tail of a long path so deep monorepo paths still
 * parse (whole-crumb drop on max(200) loses high-signal close/conflict trail).
 */
export function clampHangBreadcrumbPath(
  path: string | undefined
): string | undefined {
  if (path === undefined || path.length === 0) {
    return;
  }
  if (path.length <= HANG_BREADCRUMB_PATH_MAX) {
    return path;
  }
  return path.slice(-HANG_BREADCRUMB_PATH_MAX);
}

function clampField(
  value: string | undefined,
  max: number
): string | undefined {
  if (value === undefined || value.length === 0) {
    return;
  }
  return value.length <= max ? value : value.slice(0, max);
}

export const rendererHangBreadcrumbSchema = z
  .object({
    /** Optional active dockview content component id. */
    activePanelComponent: z
      .string()
      .max(HANG_BREADCRUMB_COMPONENT_MAX)
      .optional(),
    commandId: shortId.optional(),
    /** Free-form short detail (no file bodies). */
    detail: shortLabel.optional(),
    deletedOnDisk: z.boolean().optional(),
    dirty: z.boolean().optional(),
    diskConflict: z.boolean().optional(),
    /** Monotonic phase timing when pairing start/end (ms, 0..120s). */
    elapsedMs: z.number().int().nonnegative().max(120_000).optional(),
    kind: z.enum([
      "command",
      "panel-activate",
      "panel-close",
      "files-doc",
      "files-conflict",
      "heartbeat",
      "mark",
    ]),
    mode: z.enum(["diff", "preview", "source"]).optional(),
    panelId: z.string().max(HANG_BREADCRUMB_PANEL_ID_MAX).optional(),
    /** Project-relative or basename path only — never dump full user home. */
    path: pathHint.optional(),
    phase: z.enum(["end", "start", "state", "tick"]).optional(),
  })
  .strict();

export type RendererHangBreadcrumb = z.infer<
  typeof rendererHangBreadcrumbSchema
>;

/** Clamp string fields before Zod so oversize paths do not drop the crumb. */
export function sanitizeHangBreadcrumbFields(
  payload: RendererHangBreadcrumb
): RendererHangBreadcrumb {
  return {
    ...payload,
    ...(payload.path === undefined
      ? {}
      : { path: clampHangBreadcrumbPath(payload.path) }),
    ...(payload.detail === undefined
      ? {}
      : { detail: clampField(payload.detail, HANG_BREADCRUMB_DETAIL_MAX) }),
    ...(payload.commandId === undefined
      ? {}
      : {
          commandId: clampField(
            payload.commandId,
            HANG_BREADCRUMB_COMMAND_ID_MAX
          ),
        }),
    ...(payload.panelId === undefined
      ? {}
      : { panelId: clampField(payload.panelId, HANG_BREADCRUMB_PANEL_ID_MAX) }),
    ...(payload.activePanelComponent === undefined
      ? {}
      : {
          activePanelComponent: clampField(
            payload.activePanelComponent,
            HANG_BREADCRUMB_COMPONENT_MAX
          ),
        }),
  };
}

/** Main-side stored crumb with receive timestamp. */
export type StoredRendererHangBreadcrumb = RendererHangBreadcrumb & {
  receivedAt: number;
};

/**
 * Kinds that flush IPC immediately so a hang cannot strand them in the
 * 1s pending buffer. Heartbeats stay batched; they only need sparse liveness.
 */
export const RENDERER_HANG_BREADCRUMB_IMMEDIATE_KINDS: ReadonlySet<
  RendererHangBreadcrumb["kind"]
> = new Set(["panel-close", "files-conflict", "command"]);
