export interface TerminalComposerAttachmentDto {
  id: string;
  /** Directory attachment (folder). */
  isDirectory?: boolean;
  /** `paste` = materializeTerminalComposerTextBytes (.txt under pier-terminal-pastes). */
  kind: "image" | "file" | "paste";
  name: string;
  path: string;
  /**
   * Optional image thumbnail as data URL (main-generated).
   * Omitted for non-images or when preview generation fails.
   */
  previewDataUrl?: string | undefined;
  /** Natural pixel height of the image; set with `previewDataUrl`. */
  previewHeight?: number | undefined;
  /** Natural pixel width of the image; set with `previewDataUrl`. */
  previewWidth?: number | undefined;
  /**
   * Clipped text thumbnail (main-generated). Omitted for binaries,
   * directories, and when the head looks empty or non-text.
   */
  textPreview?: string | undefined;
}

export interface TerminalComposerPasteTextWrite {
  /** Absolute path previously returned by text materialize (must stay under pastes dir). */
  path: string;
  text: string;
}

export type TerminalComposerPasteTextWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export interface TerminalComposerPathsResult {
  attachments: TerminalComposerAttachmentDto[];
  failures: { path: string; reason: string }[];
}

export type TerminalComposerPickResult =
  | { ok: true; paths: string[] }
  | { ok: false; error: string };

export type TerminalComposerMaterializeResult =
  | { ok: true; attachment: TerminalComposerAttachmentDto | null }
  | { ok: false; error: string };

export interface TerminalComposerImageBytes {
  bytes: number[] | Uint8Array;
  mime?: string;
  name?: string;
}

export interface TerminalComposerTextBytes {
  name?: string;
  /** UTF-8 text to materialize as a .txt attachment under pier-terminal-pastes. */
  text: string;
}
