import { z } from "zod";

const transferIdSchema = z.uuid();
const windowIdSchema = z.string().min(1).max(256);

/**
 * Live drop-preview while a panel tab is dragged. HTML5 dragover does not
 * reach other WebContentsView windows, so main classifies the cursor and
 * broadcasts this to every renderer. `target` client coordinates are relative
 * to that window's content bounds (same space as resolvePlacement).
 * `outside` is mid-drag (cursor left every Pier window); `clear` ends the
 * session. Do not collapse them — source overlay ownership differs.
 */
export const panelTransferOverlayPreviewSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clear"),
      transferId: transferIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("outside"),
      transferId: transferIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("source"),
      transferId: transferIdSchema,
      windowId: windowIdSchema,
    })
    .strict(),
  z
    .object({
      clientX: z.number().finite(),
      clientY: z.number().finite(),
      kind: z.literal("target"),
      transferId: transferIdSchema,
      windowId: windowIdSchema,
    })
    .strict(),
]);
export type PanelTransferOverlayPreview = z.infer<
  typeof panelTransferOverlayPreviewSchema
>;
