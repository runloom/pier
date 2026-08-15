import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { getDocument } from "../document/store.ts";
import type { FileSaveOutcome } from "./outcome.ts";

export type FileSaveFeedback = "all" | "failure" | "none";

export async function reportFileSaveOutcome(
  context: RendererPluginContext,
  documentId: string | null,
  outcome: FileSaveOutcome,
  feedback: FileSaveFeedback
): Promise<void> {
  if (feedback === "none") {
    return;
  }
  if (outcome !== "failed") {
    return;
  }
  const document = documentId ? getDocument(documentId) : null;
  await context.dialogs.alert({
    body:
      document?.error ??
      context.i18n.t(
        "filePanel.errors.save.fallback",
        undefined,
        "Unable to save file contents."
      ),
    title: context.i18n.t(
      "filePanel.errors.save.title",
      undefined,
      "Unable to save file"
    ),
  });
}
