import { createFileEditorSessionId } from "@plugins/builtin/files/renderer/file-editor-session-id.ts";
import { describe, expect, it } from "vitest";

describe("createFileEditorSessionId", () => {
  it("preserves the stable JSON-array session encoding for an owner", () => {
    const ownerId = "pier.files.filePanel:README.md";

    expect(createFileEditorSessionId(ownerId)).toBe(JSON.stringify([ownerId]));
    expect(createFileEditorSessionId(ownerId)).toBe(
      createFileEditorSessionId(ownerId)
    );
  });
});
