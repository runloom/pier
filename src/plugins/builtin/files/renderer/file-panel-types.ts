import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export interface FilesFilePanelParams {
  context?: PanelContext;
  // tab 未保存圆点的数据通道(panel-tab-header 读 params.dirty)。
  dirty?: boolean;
  // undefined / false 表示 preview tab(Cursor 语义:点树替换,不占位);
  // true 表示 pinned tab(用户显式 pin,或在 preview 里做过第一次修改后自动 promote)。
  pinned?: boolean;
  source?: unknown;
}

export interface FilePanelRuntimeProps
  extends IDockviewPanelProps<FilesFilePanelParams> {
  runtimeContext?: RendererPluginContext;
  runtimeController: FileEditorController;
  runtimeWatchHub: FilesWatchHub;
}
