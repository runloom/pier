import { z } from "zod";

export const terminalDraftAttachmentSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["image", "file", "paste"]),
    name: z.string(),
    path: z.string(),
    isDirectory: z.boolean().optional(),
    pasteContent: z.string().max(1_048_576).optional(),
    pasteTier: z.enum(["medium", "large"]).optional(),
    textPreview: z.string().optional(),
  })
  .strict();
export const terminalDraftCompositionSchema = z
  .object({
    editorText: z.string().max(1_048_576).optional(),
    editorJson: z.string().max(4_194_304).optional(),
    attachments: z.array(terminalDraftAttachmentSchema).max(256).optional(),
  })
  .strict();
export type TerminalDraftComposition = z.infer<
  typeof terminalDraftCompositionSchema
>;

/** IPC schema parsing may reorder object keys; only content determines edits. */
export function terminalDraftCompositionKey(
  value: TerminalDraftComposition | undefined
): string {
  return JSON.stringify([
    value?.editorText,
    value?.editorJson,
    (value?.attachments ?? []).map((item) => [
      item.id,
      item.kind,
      item.name,
      item.path,
      item.isDirectory,
      item.pasteContent,
      item.pasteTier,
      item.textPreview,
    ]),
  ]);
}

/** Unsent composer input only; no conversation/output history. */
export const terminalDraftSchema = z
  .object({
    text: z.string().max(2_097_154),
    revision: z.number().int().nonnegative(),
    status: z.enum(["draft", "sending", "unconfirmed"]),
    composition: terminalDraftCompositionSchema.optional(),
    seedId: z.string().optional(),
    pendingSend: z
      .object({
        id: z.string(),
        text: z.string().max(1_048_576),
        composition: terminalDraftCompositionSchema.optional(),
      })
      .optional(),
  })
  .strict();
export const terminalDraftWriteSchema = z
  .object({
    text: z.string().max(1_048_576),
    revision: z.number().int().nonnegative(),
    composition: terminalDraftCompositionSchema.optional(),
  })
  .strict();
export type TerminalDraft = z.infer<typeof terminalDraftSchema>;
export type TerminalDraftWrite = z.infer<typeof terminalDraftWriteSchema>;
export interface TerminalDraftChanged {
  draft: TerminalDraft;
  panelId: string;
}
export function emptyTerminalDraft(): TerminalDraft {
  return { text: "", revision: 0, status: "draft" };
}
