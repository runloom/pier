import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_GROUP_VIEW_CONTENT_ID,
} from "../manifest.ts";
import { FilesGroupView } from "./files-group-view.tsx";

function isFilesActive(group: PierDockviewGroupHandle): boolean {
  const active = group.model?.activePanel ?? group.activePanel;
  return active?.view?.contentComponent === FILES_FILE_PANEL_ID;
}

export function claimFilesGroupView(input: {
  context: RendererPluginContext;
  group: PierDockviewGroupHandle;
  ownerId: symbol;
}): boolean {
  return input.context.groupContent.claim({
    group: input.group,
    id: FILES_GROUP_VIEW_CONTENT_ID,
    ownerId: input.ownerId,
    render: () => (
      <FilesGroupView context={input.context} group={input.group} />
    ),
    visible: isFilesActive,
  });
}

export function releaseFilesGroupView(input: {
  context: RendererPluginContext;
  groupId: string;
  ownerId: symbol;
}): void {
  input.context.groupContent.release({
    groupId: input.groupId,
    id: FILES_GROUP_VIEW_CONTENT_ID,
    ownerId: input.ownerId,
  });
}

export function filesGroupViewHostSlotSelector(): string {
  return `[data-slot="${FILES_GROUP_VIEW_CONTENT_ID}"]`;
}
