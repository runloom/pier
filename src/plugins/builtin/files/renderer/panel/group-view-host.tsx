import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_GROUP_VIEW_CONTENT_ID,
} from "../../manifest.ts";
import type { FileEditorController } from "../editor/controller.ts";
import type { FilesWatchHub } from "../watch-hub.ts";
import { FilesGroupView } from "./group-view.tsx";

function isFilesActive(group: PierDockviewGroupHandle): boolean {
  const active = group.model?.activePanel ?? group.activePanel;
  return active?.view?.contentComponent === FILES_FILE_PANEL_ID;
}

export function claimFilesGroupView(input: {
  context: RendererPluginContext;
  controller: FileEditorController;
  group: PierDockviewGroupHandle;
  ownerId: symbol;
  watchHub: FilesWatchHub;
}): boolean {
  return input.context.groupContent.claim({
    group: input.group,
    id: FILES_GROUP_VIEW_CONTENT_ID,
    ownerId: input.ownerId,
    render: () => (
      <FilesGroupView
        context={input.context}
        controller={input.controller}
        group={input.group}
        watchHub={input.watchHub}
      />
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
