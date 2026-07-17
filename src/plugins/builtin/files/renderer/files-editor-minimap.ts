import type { Extension } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";

export function createMinimapExtension(): Extension {
  return showMinimap.compute(["doc"], () => ({
    create: () => ({ dom: document.createElement("div") }),
    // VS Code default is character-like rendering; blocks is thicker and more intrusive.
    displayText: "characters" as const,
    showOverlay: "always" as const,
  }));
}
