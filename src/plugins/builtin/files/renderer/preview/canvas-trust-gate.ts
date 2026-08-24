import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { normalizeProjectRootKey } from "@shared/live-module-canvas-path.ts";
import type { FilesTranslate } from "../i18n.ts";
import type { CanvasPreviewState } from "./canvas-compile-state.ts";

/**
 * Canvas project trust gate (画布项目信任门，renderer 侧同意 UX).
 *
 * Main enforces the gate at compile time; this module turns a
 * `trust.projectRootPath` compile refusal into a first-open confirm dialog and
 * retries after the user grants trust. Concurrent previews of one project share
 * a single dialog via an in-flight map keyed by normalized project root.
 *
 * Declining keeps the canvas unmounted — nothing executes without consent.
 */

export type CanvasTrustGateOutcome = "trusted" | "declined";

/** Per-root in-flight confirmations so N panels ask once, not N times. */
const inflightConfirms = new Map<string, Promise<CanvasTrustGateOutcome>>();

/** Test hook: drop shared in-flight state. */
export function resetCanvasTrustGateForTests(): void {
  inflightConfirms.clear();
}

/** Error state shown when previewing is refused (declined or revoked). */
export function trustDeclinedState(t: FilesTranslate): CanvasPreviewState {
  return {
    diagnostics: [],
    kind: "error",
    message: t(
      "filePanel.canvas.trustDeclined",
      "Preview stopped: this project’s canvases aren’t trusted. Reload to decide again."
    ),
  };
}

export function canvasTrustProjectLabel(projectRootPath: string): string {
  const key = normalizeProjectRootKey(projectRootPath);
  const segments = key.split("/").filter(Boolean);
  return segments.at(-1) ?? key;
}

function translate(
  t: FilesTranslate,
  key: string,
  fallback: string,
  values?: Record<string, string>
): string {
  return t(key, fallback, values);
}

async function confirmAndRecord(
  context: RendererPluginContext,
  t: FilesTranslate,
  projectRootPath: string
): Promise<CanvasTrustGateOutcome> {
  const projectName = canvasTrustProjectLabel(projectRootPath);
  const accepted = await context.dialogs.confirm({
    body: translate(
      t,
      "filePanel.canvas.trustDialogBody",
      "“{{project}}” contains canvases with executable code. Previewing runs that code on this computer. Only trust sources you know.",
      { project: projectName }
    ),
    cancelLabel: translate(
      t,
      "filePanel.canvas.trustCancelLabel",
      "Don’t preview"
    ),
    confirmLabel: translate(
      t,
      "filePanel.canvas.trustConfirmLabel",
      "Trust and preview"
    ),
    intent: "default",
    title: translate(
      t,
      "filePanel.canvas.trustDialogTitle",
      "Trust canvases from this project?"
    ),
  });
  if (!accepted) {
    return "declined";
  }
  await context.liveModules.grantTrust(projectRootPath);
  return "trusted";
}

/**
 * Ensure the project root is trusted before compiling its canvases.
 * Resolves `"trusted"` when a decision exists or was just granted.
 */
export async function ensureProjectCanvasTrusted(input: {
  context: RendererPluginContext;
  projectRootPath: string;
  t: FilesTranslate;
}): Promise<CanvasTrustGateOutcome> {
  const { context, projectRootPath, t } = input;
  const status = await context.liveModules.trustStatus(projectRootPath);
  if (status.trusted) {
    return "trusted";
  }

  const rootKey = normalizeProjectRootKey(projectRootPath);
  const inflight = inflightConfirms.get(rootKey);
  if (inflight) {
    return inflight;
  }
  const pending = confirmAndRecord(context, t, projectRootPath).finally(() => {
    inflightConfirms.delete(rootKey);
  });
  inflightConfirms.set(rootKey, pending);
  return pending;
}
