import type { TerminalComposerAttachmentDto } from "@shared/contracts/terminal.ts";
import type { ComposerAttachment } from "../composer-attachments-model.ts";
export const previews = new Map<
  string,
  Pick<ComposerAttachment, "previewDataUrl" | "previewWidth" | "previewHeight">
>();
export const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];

/** Serialize attach merges so concurrent pick/drop/paste cannot clobber Map. */
let mergeChain: Promise<void> = Promise.resolve();

export function enqueueMerge(task: () => void | Promise<void>): Promise<void> {
  const run = mergeChain.then(task, task);
  mergeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetTerminalComposerAttachmentsForTests(): void {
  previews.clear();
  mergeChain = Promise.resolve();
}

/**
 * Map main DTO → rail attachment for pick/resolve/image paths.
 * Text paste DTOs never carry body/tier here — only `createPasteAttachment`
 * / materializeTieredPlainPaste may create expandable medium pastes.
 * A bare `kind: "paste"` DTO is treated as path-only (non-expandable).
 */
export function dtoToAttachment(
  dto: TerminalComposerAttachmentDto
): ComposerAttachment {
  return {
    id: dto.id,
    // Keep paste kind for rail open routing when main returns paste materialize
    // without going through materializeTieredPlainPaste (should not happen in
    // production); without pasteTier/content, send uses path semantics.
    kind: dto.kind === "paste" ? "paste" : dto.kind,
    name: dto.name,
    path: dto.path,
    ...(dto.isDirectory ? { isDirectory: dto.isDirectory } : {}),
    ...(dto.previewDataUrl ? { previewDataUrl: dto.previewDataUrl } : {}),
    ...(dto.previewWidth ? { previewWidth: dto.previewWidth } : {}),
    ...(dto.previewHeight ? { previewHeight: dto.previewHeight } : {}),
    ...(dto.textPreview ? { textPreview: dto.textPreview } : {}),
  };
}
