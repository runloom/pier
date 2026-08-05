import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { authorizeDiskReplace } from "./disk-protection.ts";
import type { FileDocumentLoader } from "./loader.ts";
import { getDocument } from "./store.ts";

/** Standard reload path; forceAdopt = one-shot disk-replace authorization. */
export async function reloadDiskDocument(input: {
  context: RendererPluginContext;
  documentId: string;
  forceAdopt: boolean;
  loader: Pick<FileDocumentLoader, "start" | "waitFor">;
  unavailable: boolean;
}): Promise<void> {
  if (input.unavailable) {
    throw new Error("File document reload is not available right now.");
  }
  const document = getDocument(input.documentId);
  if (document?.source.kind !== "disk") {
    throw new Error("Only disk files can be reloaded from disk.");
  }
  if (input.forceAdopt) {
    authorizeDiskReplace(document.id);
  }
  input.loader.start(document.id, true);
  await input.loader.waitFor(document.id);
  const latest = getDocument(document.id);
  if (!latest) {
    throw new Error("The file is no longer open.");
  }
  if (latest.error) {
    throw new Error(latest.error);
  }
  if (input.forceAdopt && latest.diskConflict) {
    throw new Error(
      input.context.i18n.t(
        "filePanel.conflict.loadDiskFailed",
        undefined,
        "Unable to load the disk version of this file."
      )
    );
  }
}
