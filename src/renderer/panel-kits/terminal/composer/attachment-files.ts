import type { TerminalComposerAttachmentDto } from "@shared/contracts/terminal.ts";
import type { ComposerAttachment } from "../composer-attachments-model.ts";

/** Path-only DTOs never acquire expandable text-paste content or a paste tier. */
export function dtoToAttachment(
  dto: TerminalComposerAttachmentDto
): ComposerAttachment {
  return {
    id: dto.id,
    kind: dto.kind,
    name: dto.name,
    path: dto.path,
    ...(dto.isDirectory ? { isDirectory: dto.isDirectory } : {}),
    ...(dto.previewDataUrl ? { previewDataUrl: dto.previewDataUrl } : {}),
    ...(dto.previewWidth ? { previewWidth: dto.previewWidth } : {}),
    ...(dto.previewHeight ? { previewHeight: dto.previewHeight } : {}),
    ...(dto.textPreview ? { textPreview: dto.textPreview } : {}),
  };
}

export async function collectComposerFiles(input: {
  enqueueMerge: (task: () => void | Promise<void>) => Promise<void>;
  files: FileList | File[];
  mergeAttachments: (attachments: readonly ComposerAttachment[]) => boolean;
  reportError: (titleKey: string, detail: string) => void;
  resolveAndMerge: (paths: readonly string[]) => Promise<boolean>;
  signal: AbortSignal;
}): Promise<boolean> {
  const {
    enqueueMerge,
    files,
    mergeAttachments,
    reportError,
    resolveAndMerge,
    signal,
  } = input;
  if (signal.aborted) {
    return false;
  }
  const paths: string[] = [];
  const pathlessImages: File[] = [];
  for (const file of Array.from(files)) {
    // Sandboxed Electron uses webUtils.getPathForFile rather than File.path.
    let path = (file as File & { path?: string }).path;
    if (typeof path !== "string" || path.length === 0) {
      try {
        path = window.pier.terminal.getPathForFile(file);
      } catch {
        path = undefined;
      }
    }
    if (typeof path === "string" && path.length > 0) {
      paths.push(path);
    } else if (file.type.startsWith("image/")) {
      pathlessImages.push(file);
    }
    // Pathless non-images have no usable attachment source.
  }
  let advanced = await resolveAndMerge(paths);
  if (signal.aborted) {
    return false;
  }
  for (const file of pathlessImages) {
    await enqueueMerge(async () => {
      if (signal.aborted) {
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        if (signal.aborted) {
          return;
        }
        const result = await window.pier.terminal.materializeComposerImageBytes(
          {
            bytes: new Uint8Array(buffer),
            ...(file.type ? { mime: file.type } : {}),
            ...(file.name ? { name: file.name } : {}),
          }
        );
        if (signal.aborted) {
          return;
        }
        if (!result.ok) {
          reportError("terminal.composer.attachFailed", result.error);
          return;
        }
        if (
          result.attachment &&
          mergeAttachments([dtoToAttachment(result.attachment)])
        ) {
          advanced = true;
        }
      } catch (error: unknown) {
        if (!signal.aborted) {
          reportError(
            "terminal.composer.attachFailed",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    });
    if (signal.aborted) {
      return false;
    }
  }
  return advanced;
}
