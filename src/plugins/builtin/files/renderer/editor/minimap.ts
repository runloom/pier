import type { Extension } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";
import { gitGutterField } from "./git-gutter.ts";

/**
 * 源码编辑器右侧缩略图。
 * gutters 单轨镜像 SCM 行级变更（与左侧 git gutter 同一 field）；
 * 颜色已在 setGitGutterMarkers 边界解析为具体色值。
 */
export function createMinimapExtension(): Extension {
  return showMinimap.compute([gitGutterField], (state) => ({
    create: () => ({ dom: document.createElement("div") }),
    // VS Code default is character-like rendering; blocks is thicker and more intrusive.
    displayText: "characters" as const,
    gutters: [state.field(gitGutterField).minimapGutter],
    showOverlay: "always" as const,
  }));
}
