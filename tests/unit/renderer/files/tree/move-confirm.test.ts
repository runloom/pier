import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createFilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import {
  confirmTreeMoves,
  handleTreeDragMoves,
} from "@plugins/builtin/files/renderer/tree/action-utils.ts";
import { describe, expect, it, vi } from "vitest";

function makeContext() {
  const confirm = vi.fn<RendererPluginContext["dialogs"]["confirm"]>(
    async () => true
  );
  const context = {
    dialogs: { confirm },
    i18n: {
      t: vi.fn(
        (
          _key: string,
          values?: Record<string, number | string>,
          fallback?: string
        ) => {
          let text = fallback ?? _key;
          for (const [name, value] of Object.entries(values ?? {})) {
            text = text.replaceAll(`{{${name}}}`, String(value));
          }
          return text;
        }
      ),
    },
  } as unknown as RendererPluginContext;
  return { confirm, context };
}

describe("confirmTreeMoves", () => {
  it("asks once with the single-move body and returns the dialog result", async () => {
    const { confirm, context } = makeContext();
    confirm.mockResolvedValue(false);

    const result = await confirmTreeMoves({
      context,
      moves: [{ from: "src/a.ts", to: "src/utils/a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      body: 'Move "a.ts" into "utils"?',
      cancelLabel: "Cancel",
      confirmLabel: "Move",
      intent: "default",
      title: "Move",
    });
  });

  it("uses the multi-move body with count", async () => {
    const { confirm, context } = makeContext();

    await confirmTreeMoves({
      context,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      t: createFilesTranslate(context),
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Move 2 items into "lib"?' })
    );
  });

  it("names the project root for root drops", async () => {
    const { confirm, context } = makeContext();

    await confirmTreeMoves({
      context,
      moves: [{ from: "src/a.ts", to: "a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Move "a.ts" into "project root"?' })
    );
  });

  it("skips the dialog when every move is a no-op", async () => {
    const { confirm, context } = makeContext();

    const result = await confirmTreeMoves({
      context,
      moves: [{ from: "a.ts", to: "a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(result).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("handleTreeDragMoves", () => {
  it("performs each move after confirmation", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);

    await handleTreeDragMoves({
      confirm: async () => true,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      performMove,
    });

    expect(performMove.mock.calls).toEqual([
      ["a.ts", "lib/a.ts"],
      ["b.ts", "lib/b.ts"],
    ]);
  });

  it("does not move or roll back when the user cancels", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);

    await handleTreeDragMoves({
      confirm: async () => false,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      performMove,
    });

    expect(performMove).not.toHaveBeenCalled();
  });

  it("treats a confirm failure as cancel", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);

    await handleTreeDragMoves({
      confirm: async () => {
        throw new Error("dialog gone");
      },
      moves: [{ from: "a.ts", to: "lib/a.ts" }],
      performMove,
    });

    expect(performMove).not.toHaveBeenCalled();
  });

  it("does nothing when every move is a no-op", async () => {
    const confirm = vi.fn(async () => true);
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);

    await handleTreeDragMoves({
      confirm,
      moves: [{ from: "a.ts", to: "a.ts" }],
      performMove,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(performMove).not.toHaveBeenCalled();
  });
});
