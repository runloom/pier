import { useLiveModuleCanvasFileScope } from "@plugins/api/live-module-canvas-file.tsx";
import {
  type CanvasCommandInvokeResult,
  canvasCommandInvokeResultSchema,
} from "@shared/contracts/canvas-command.ts";
import type { FileWatchChangeKind } from "@shared/contracts/file/watch.ts";
import type { FileDocumentExpectedState } from "@shared/contracts/file.ts";
import { canvasSiblingProjectPath } from "@shared/live-module-canvas-path.ts";
import i18next from "i18next";
import { useMemo } from "react";

/**
 * `useCanvasFile()` — the sibling-file read/write channel exposed to canvases
 * through `pier/canvas`.
 *
 * Scope on purpose: a canvas names a file in its own folder (or one nested
 * folder) and nothing else. The host supplies the project root and the canvas
 * directory. Writes go through `file.writeDocument`. `watch` wraps the existing
 * `pier://file:changed` listener after starting the project-root file watch.
 *
 * Revisions are not cached here: a caller reads to learn the current revision,
 * writes against it, and gets `conflict` back when the file moved underneath.
 * Deciding what to do about a conflict belongs to the canvas, not to this hook.
 */

export interface CanvasFileReadResult {
  contents: string;
  /** Opaque revision to pass back to {@link CanvasFileApi.write}. */
  revision: string;
}

export type CanvasFileWriteOutcome =
  | { kind: "written"; revision: string }
  /** File changed since `expectedRevision`; re-read and decide. */
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

export interface CanvasFileWatchEvent {
  kind: FileWatchChangeKind;
  path: string;
}

export type CanvasFileCommandOutcome =
  | CanvasCommandInvokeResult
  | { kind: "failed"; message: string };

export interface CanvasFileApi {
  /** False when the canvas has no file scope (preview or test harness). */
  available: boolean;
  /** Project-relative directory of the canvas, for user-facing messages. */
  directory: string;
  invokeCommand: (key: string) => Promise<CanvasFileCommandOutcome>;
  read: (fileName: string) => Promise<CanvasFileReadResult>;
  /** Stop listening by calling the returned function (including on unmount). */
  watch: (
    fileName: string,
    listener: (event: CanvasFileWatchEvent) => void
  ) => () => void;
  /** `expectedRevision: null` means "the file must not exist yet". */
  write: (
    fileName: string,
    contents: string,
    expectedRevision: string | null
  ) => Promise<CanvasFileWriteOutcome>;
}

/**
 * Translate at call time, tolerating an uninitialised i18next: canvases also
 * mount in test harnesses and previews that never boot the host i18n instance.
 */
function message(
  key: string,
  fallback: string,
  vars: Record<string, string> = {}
): string {
  if (i18next.isInitialized) {
    return i18next.t(key, { defaultValue: fallback, ...vars });
  }
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    fallback
  );
}

function expectedState(revision: string | null): FileDocumentExpectedState {
  return revision === null
    ? { kind: "absent" }
    : { kind: "revision", revision };
}

export function useCanvasFile(): CanvasFileApi {
  const scope = useLiveModuleCanvasFileScope();

  return useMemo<CanvasFileApi>(() => {
    const resolvePath = (fileName: string): string => {
      if (!scope) {
        throw new Error(
          message(
            "canvas.file.unavailable",
            "This canvas isn’t opened from a file, so it can’t save."
          )
        );
      }
      const path = canvasSiblingProjectPath(scope.path, fileName);
      if (!path) {
        throw new Error(
          message(
            "canvas.file.invalidName",
            "A canvas may only use files in its own folder."
          )
        );
      }
      return path;
    };

    return {
      available: scope !== null,
      directory: scope?.directory ?? "",
      invokeCommand: async (key) => {
        if (!scope) {
          return {
            kind: "failed",
            message: message(
              "canvas.command.unavailable",
              "This canvas isn’t opened from a file, so it can’t run commands."
            ),
          };
        }
        const host = window.pier?.canvasHost;
        if (!host) {
          return {
            kind: "failed",
            message: message(
              "canvas.command.unavailable",
              "This canvas isn’t opened from a file, so it can’t run commands."
            ),
          };
        }
        try {
          const raw = await host.invoke({
            payload: {
              canvasPath: scope.path,
              key,
              projectRootPath: scope.root,
            },
            type: "canvasCommand.invoke",
          });
          const parsed = canvasCommandInvokeResultSchema.safeParse(raw);
          if (!parsed.success) {
            return {
              kind: "failed",
              message: message(
                "canvas.command.failed",
                "Couldn’t run that command."
              ),
            };
          }
          return parsed.data;
        } catch (error) {
          return {
            kind: "failed",
            message:
              error instanceof Error
                ? error.message
                : message(
                    "canvas.command.failed",
                    "Couldn’t run that command."
                  ),
          };
        }
      },
      read: async (fileName) => {
        const path = resolvePath(fileName);
        const result = await window.pier.files.readDocument({
          path,
          root: scope?.root ?? "",
        });
        if (result.kind !== "text") {
          throw new Error(
            message(
              "canvas.file.readFailed",
              "Couldn’t read {{name}} — it isn’t a text file.",
              { name: fileName }
            )
          );
        }
        return { contents: result.contents, revision: result.revision };
      },
      watch: (fileName, listener) => {
        if (!scope) {
          return () => undefined;
        }
        const path = resolvePath(fileName);
        const watchFn = window.pier.files?.watch;
        if (!watchFn) {
          return () => undefined;
        }
        return watchFn(scope.root, (event) => {
          for (const change of event.changes) {
            if (change.path === path) {
              listener({ kind: change.kind, path: change.path });
            }
          }
        });
      },
      write: async (fileName, contents, expectedRevision) => {
        let path: string;
        try {
          path = resolvePath(fileName);
        } catch (error) {
          return {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        try {
          const result = await window.pier.files.writeDocument({
            contents,
            eol: "lf",
            expected: expectedState(expectedRevision),
            format: { bom: false, encoding: "utf8" },
            path,
            root: scope?.root ?? "",
          });
          if (result.kind === "written") {
            return { kind: "written", revision: result.revision };
          }
          if (result.kind === "conflict") {
            return {
              kind: "conflict",
              message: message(
                "canvas.file.conflict",
                "{{name}} changed on disk. Reload it before saving again.",
                { name: fileName }
              ),
            };
          }
          return { kind: "failed", message: result.message };
        } catch (error) {
          return {
            kind: "failed",
            message:
              error instanceof Error
                ? error.message
                : message(
                    "canvas.file.writeFailed",
                    "Couldn’t save {{name}}.",
                    {
                      name: fileName,
                    }
                  ),
          };
        }
      },
    };
  }, [scope]);
}
