import type {
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { readFilesEditorDefaultEol } from "../editor/prefs.ts";
import { createFileFilePanelInstanceId } from "../panel/id.ts";
import { panelSourceForDocument } from "../panel/source.ts";

export function openUntitledFileFromCreateMenu(
  context: RendererPluginContext,
  controller: FileEditorController,
  invocation?: RendererPluginActionInvocation
): void {
  const document = controller.createUntitledDocument({
    contents: "",
    eol: readFilesEditorDefaultEol(context),
    language: "text",
    nameKind: "plain",
  });
  const source = panelSourceForDocument(document);
  if (source?.kind !== "untitled") {
    return;
  }
  const panelContext =
    invocation?.sourcePanelContext ?? context.panels.getActiveContext();
  context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(panelContext ? { context: panelContext } : {}),
    dropUnpinnedInstances: false,
    instanceId: createFileFilePanelInstanceId(source),
    params: {
      dirty: true,
      pinned: true,
      source,
    },
    ...(invocation?.sourcePanelGroupId
      ? { targetGroupId: invocation.sourcePanelGroupId }
      : {}),
    title: document.name,
  });
}
