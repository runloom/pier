import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateFilesLspDefinition } from "../../../src/plugins/builtin/files/renderer/files-lsp-definition-navigate.ts";

describe("navigateFilesLspDefinition", () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy();
    }
  });

  function mount(doc = "export const alpha = 1;"): EditorView {
    const view = new EditorView({
      state: EditorState.create({ doc }),
    });
    views.push(view);
    return view;
  }

  it("selects the full target range in the current file", async () => {
    const view = mount();
    const dispatch = vi.spyOn(view, "dispatch");
    const mapping = {
      destroy: vi.fn(),
      getMapping: vi.fn(() => null),
      mapPosition: vi.fn(),
    };
    const plugin = {
      fromPosition: vi.fn(
        (position: { character: number }) => position.character
      ),
      uri: "file:///repo/a.ts",
      client: { workspace: { displayFile: vi.fn() } },
    };

    const result = await navigateFilesLspDefinition({
      mapping: mapping as never,
      plugin: plugin as never,
      sourceView: view,
      target: {
        range: {
          end: { character: 17, line: 0 },
          start: { character: 13, line: 0 },
        },
        uri: "file:///repo/a.ts",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollIntoView: true,
        selection: { anchor: 13, head: 17 },
        userEvent: "select.definition",
      })
    );
  });

  it("opens a cross-file target through displayFile", async () => {
    const source = mount("import { alpha } from './b';");
    const target = mount("export const alpha = 1;");
    const mapping = {
      destroy: vi.fn(),
      getMapping: vi.fn(() => ({ mapped: true })),
      mapPosition: vi.fn(
        (_uri: string, position: { character: number }) => position.character
      ),
    };
    const displayFile = vi.fn(async () => target);
    const plugin = {
      fromPosition: vi.fn(),
      uri: "file:///repo/a.ts",
      client: { workspace: { displayFile } },
    };

    const result = await navigateFilesLspDefinition({
      mapping: mapping as never,
      plugin: plugin as never,
      sourceView: source,
      target: {
        range: {
          end: { character: 17, line: 0 },
          start: { character: 13, line: 0 },
        },
        uri: "file:///repo/b.ts",
      },
    });

    expect(result).toEqual({ ok: true });
    expect(displayFile).toHaveBeenCalledWith("file:///repo/b.ts");
    expect(mapping.mapPosition).toHaveBeenCalled();
  });

  it("returns open-failed when displayFile yields null", async () => {
    const view = mount();
    const mapping = {
      destroy: vi.fn(),
      getMapping: vi.fn(() => null),
      mapPosition: vi.fn(),
    };
    const plugin = {
      fromPosition: vi.fn(),
      uri: "file:///repo/a.ts",
      client: { workspace: { displayFile: vi.fn(async () => null) } },
    };

    await expect(
      navigateFilesLspDefinition({
        mapping: mapping as never,
        plugin: plugin as never,
        sourceView: view,
        target: {
          range: {
            end: { character: 1, line: 0 },
            start: { character: 0, line: 0 },
          },
          uri: "file:///repo/missing.ts",
        },
      })
    ).resolves.toEqual({ ok: false, reason: "open-failed" });
  });
});
