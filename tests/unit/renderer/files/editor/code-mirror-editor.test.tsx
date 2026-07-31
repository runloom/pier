import { CodeMirrorEditor } from "@plugins/builtin/files/renderer/editor/cm.tsx";
import { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function createController() {
  const controller = Object.create(
    FileEditorController.prototype
  ) as FileEditorController;
  const attachView = vi
    .spyOn(controller, "attachView")
    .mockImplementation(() => undefined);
  const detachView = vi
    .spyOn(controller, "detachView")
    .mockImplementation(() => undefined);
  vi.spyOn(controller, "updateViewPresentation").mockImplementation(
    () => undefined
  );
  return { attachView, controller, detachView };
}

function editor(controller: FileEditorController) {
  return (
    <CodeMirrorEditor
      controller={controller}
      documentId="document-1"
      editorSessionId="session-1"
      mode="source"
      openExternal={vi.fn()}
      value=""
    />
  );
}

describe("CodeMirrorEditor host ref lifecycle", () => {
  it("detaches each callback ref from its own host when the callback changes", () => {
    const first = createController();
    const second = createController();
    const view = render(editor(first.controller));
    const host = view.getByTestId("files-code-mirror-editor");

    expect(first.attachView).toHaveBeenCalledWith(
      expect.objectContaining({ parent: host })
    );

    view.rerender(editor(second.controller));

    expect(first.detachView).toHaveBeenCalledWith("session-1", host);
    expect(second.attachView).toHaveBeenCalledWith(
      expect.objectContaining({ parent: host })
    );

    view.unmount();
    expect(second.detachView).toHaveBeenCalledWith("session-1", host);
  });
});
