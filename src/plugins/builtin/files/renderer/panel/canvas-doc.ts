import {
  isProjectCanvasPath,
  liveModuleProjectContentDirectories,
} from "@shared/live-module-canvas-path.ts";
import type { FilesDocument } from "../document/types.ts";

/** True when the open document should use canvas editor/preview. */
export function isCanvasDiskDoc(document: FilesDocument): boolean {
  if (document.language === "canvas") {
    return true;
  }
  return (
    document.source.kind === "disk" &&
    isProjectCanvasPath(
      document.source.path,
      liveModuleProjectContentDirectories(document.source.root)
    )
  );
}
