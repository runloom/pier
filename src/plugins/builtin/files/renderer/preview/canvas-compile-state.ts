import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { LiveModuleFramework } from "@shared/live-module-framework.ts";

/** Only show skeleton if compile still pending after this delay (avoids flash). */
export const CANVAS_SKELETON_DELAY_MS = 200;

/** Hot-reload compile failure / warnings while previous mount stays visible. */
export interface SoftError {
  diagnostics: LiveModuleDiagnostic[];
  message: string;
}

export type CanvasPreviewState =
  | { kind: "pending" }
  | { kind: "loading" }
  | {
      kind: "ready";
      framework: LiveModuleFramework;
      /** Hot-reload compile failure: keep previous mount, show banner. */
      softError?: SoftError;
    }
  | {
      kind: "error";
      message: string;
      diagnostics: LiveModuleDiagnostic[];
      /**
       * True when the canvas mounted then crashed (React boundary / uncaught).
       * Content is gone — full Empty, never soft Alert banner.
       */
      isRuntime?: boolean;
    };

/** Identity of a mounted canvas generation (hot reload keeps the same one). */
export function moduleIdentity(
  root: string,
  contentDirectory: string,
  relPath: string,
  framework: LiveModuleFramework
): string {
  return `${root}\0${contentDirectory}\0${relPath}\0${framework}`;
}
