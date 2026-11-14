import type { RendererPluginContext } from "@plugins/api/renderer.ts";

export type DocumentPreviewContext = Pick<
  RendererPluginContext,
  "dialogs" | "externalNavigation" | "filePreviews" | "files" | "notifications"
>;

export type PreviewSourceError =
  | "deleted"
  | "fetch-failed"
  | "stale"
  | "too-large";

export type DocumentRenderError =
  | PreviewSourceError
  | "encrypted"
  | "parse-failed"
  | "render-failed"
  | "renderer-missing"
  | "zip-limit";

export type PreviewSourceState =
  | { status: "loading"; bytes: null; error: null }
  | { status: "ready"; bytes: Uint8Array; error: null }
  | { status: "error"; bytes: null; error: PreviewSourceError };
