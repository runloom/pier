import { z } from "zod";

export const panelFloatingPositionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export type PanelFloatingPosition = z.infer<typeof panelFloatingPositionSchema>;

export const panelFloatingLayoutSchema = z
  .object({
    positions: z.record(z.string().min(1), panelFloatingPositionSchema),
    version: z.literal(1),
  })
  .strict();
export type PanelFloatingLayout = z.infer<typeof panelFloatingLayoutSchema>;

export const DEFAULT_PANEL_FLOATING_POSITION: PanelFloatingPosition = {
  x: 0.5,
  y: 0,
};

export function emptyPanelFloatingLayout(): PanelFloatingLayout {
  return { positions: {}, version: 1 };
}

export function panelFloatingLayoutFromParams(
  params: unknown
): PanelFloatingLayout {
  if (!(params && typeof params === "object" && "floatingLayout" in params)) {
    return emptyPanelFloatingLayout();
  }
  const parsed = panelFloatingLayoutSchema.safeParse(params.floatingLayout);
  return parsed.success ? parsed.data : emptyPanelFloatingLayout();
}
