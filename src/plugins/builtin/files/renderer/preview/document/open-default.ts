import { absoluteDiskSourcePath } from "../../document/paths.ts";
import type { FilesDocument } from "../../document/types.ts";
import type { FilesTranslate } from "../../i18n.ts";
import type { DocumentPreviewContext } from "./types.ts";

export async function openDocumentInDefaultApp(args: {
  context: DocumentPreviewContext;
  document: FilesDocument;
  t: FilesTranslate;
}): Promise<void> {
  const { context, document, t } = args;
  const source = document.source;
  if (source.kind !== "disk") {
    return;
  }
  const relative = document.canonicalPath ?? source.path;
  const absolutePath = absoluteDiskSourcePath(source.root, relative);
  try {
    const result = await context.files.openPath({ path: absolutePath });
    if (result.opened) {
      return;
    }
  } catch {
    // Fall through to the explicit failure alert.
  }
  await context.dialogs
    .alert({
      body: t(
        "filePanel.documentPreview.openFailed.description",
        "The file could not be opened in the default app. Check that the app is installed, then try again."
      ),
      intent: "default",
      title: t(
        "filePanel.documentPreview.openFailed.title",
        "Unable to open file"
      ),
    })
    .catch(() => undefined);
}
