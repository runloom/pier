import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FILES_FILE_PANEL_ID } from "../../../manifest.ts";
import type { FilesDocumentPanelSource } from "../../document/types.ts";
import type { MarkdownInternalTarget } from "../../markdown/resource-elements.tsx";
import { createFileFilePanelInstanceId } from "../id.ts";

/** Preserve anchors so the normal preview resolves headings and footnotes. */
export function openMarkdownInternal({
  context,
  root,
  target,
  panelContext,
}: {
  context: RendererPluginContext;
  root: string;
  target: MarkdownInternalTarget;
  panelContext: PanelContext | undefined;
}) {
  const source: FilesDocumentPanelSource = {
    kind: "disk",
    path: target.path,
    root,
  };
  return context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(panelContext ? { context: panelContext } : {}),
    dropUnpinnedInstances: true,
    instanceId: createFileFilePanelInstanceId(source),
    params: {
      ...(target.fragment
        ? {
            markdownAnchor: target.fragment,
            markdownAnchorRequestId: crypto.randomUUID(),
          }
        : {}),
      pinned: false,
      source,
    },
    title: target.path.split("/").at(-1) ?? target.path,
  });
}
