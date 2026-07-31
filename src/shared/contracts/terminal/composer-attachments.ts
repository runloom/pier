export interface TerminalComposerAttachmentDto {
  id: string;
  /** Directory attachment (folder). */
  isDirectory?: boolean;
  kind: "image" | "file";
  name: string;
  path: string;
  /**
   * Optional image thumbnail as data URL (main-generated).
   * Omitted for non-images or when preview generation fails.
   */
  previewDataUrl?: string | undefined;
}

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
