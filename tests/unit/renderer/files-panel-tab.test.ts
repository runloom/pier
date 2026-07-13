import { filesPanelTabChrome } from "@plugins/builtin/files/renderer/files-panel-tab.ts";
import { describe, expect, it } from "vitest";

describe("Files panel tab chrome", () => {
  it("derives disk file icons from the basename", () => {
    expect(
      filesPanelTabChrome({
        source: { kind: "disk", path: "src/file.ts", root: "/repo" },
      })
    ).toEqual({ icon: { id: "pier.file:file.ts" } });
  });

  it("derives untitled icons from the document name", () => {
    expect(
      filesPanelTabChrome({
        source: { id: "draft-1", kind: "untitled", name: "Untitled.md" },
      })
    ).toEqual({ icon: { id: "pier.file:Untitled.md" } });
  });

  it("keeps project-only and malformed panels on the registration icon", () => {
    expect(filesPanelTabChrome({})).toBeUndefined();
    expect(filesPanelTabChrome({ source: { kind: "disk" } })).toBeUndefined();
  });
});
