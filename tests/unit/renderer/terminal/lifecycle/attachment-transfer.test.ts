import {
  emptyTerminalDraft,
  type TerminalDraft,
  type TerminalDraftWrite,
} from "@shared/contracts/terminal/draft.ts";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ClipboardEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  resetTerminalComposerAttachmentsForTests,
  useTerminalComposerAttachments,
} from "@/panel-kits/terminal/hooks/use-composer-attachments.ts";
import {
  acceptTerminalDraft,
  flushTerminalDraft,
  freezeTerminalDraft,
  readTerminalDraftText,
  resetTerminalDraftMirrorsForTests,
  writeTerminalDraftText,
} from "@/stores/terminal-drafts.store.ts";

let durable: TerminalDraft;
const pick = vi.fn();
const materialize = vi.fn();
const resolved = {
  attachments: [{ id: "file", kind: "file", name: "a.ts", path: "/a.ts" }],
  failures: [],
};
beforeEach(() => {
  resetTerminalDraftMirrorsForTests();
  resetTerminalComposerAttachmentsForTests();
  pick.mockReset();
  materialize.mockReset();
  durable = emptyTerminalDraft();
  acceptTerminalDraft("p", durable);
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      terminal: {
        pickComposerFiles: pick,
        resolveComposerPaths: async () => resolved,
        materializeComposerImageBytes: materialize,
        getPathForFile: () => undefined,
        readDraft: async () => durable,
        writeDraft: async (_panel: string, draft: TerminalDraftWrite) => {
          durable = { ...durable, ...draft, revision: durable.revision + 1 };
          return durable;
        },
      },
    },
  });
});
afterEach(() => {
  cleanup();
  resetTerminalDraftMirrorsForTests();
});

function composer() {
  return renderHook(() =>
    useTerminalComposerAttachments({
      disabled: false,
      panelId: "p",
      reportError: vi.fn(),
      t: (key) => key,
      getDraftAndCursor: () => ({
        draft: readTerminalDraftText("p"),
        cursor: readTerminalDraftText("p").length,
      }),
      onDraftChange: (text) => writeTerminalDraftText("p", text),
    })
  );
}

it("waits for a new attachment even when an older save is already awaiting its acknowledgement", async () => {
  const acknowledged = Promise.withResolvers<TerminalDraft>();
  const write = vi
    .spyOn(window.pier.terminal, "writeDraft")
    .mockImplementationOnce(() => acknowledged.promise);
  act(() => writeTerminalDraftText("p", "before attachment"));
  const oldSave = flushTerminalDraft("p");
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

  const selection = Promise.withResolvers<{ ok: true; paths: string[] }>();
  pick.mockReturnValue(selection.promise);
  const hook = composer();
  act(() => hook.result.current.pickFiles());
  act(() => freezeTerminalDraft("p", true));
  let flushed = false;
  const transferFlush = flushTerminalDraft("p").then(() => {
    flushed = true;
  });
  await act(async () => {
    durable = { ...durable, text: "before attachment", revision: 1 };
    acknowledged.resolve(durable);
    await oldSave;
  });
  expect(flushed).toBe(false);
  await act(async () => {
    selection.resolve({ ok: true, paths: ["/a.ts"] });
    await transferFlush;
  });
  expect(durable.composition?.attachments).toMatchObject([{ path: "/a.ts" }]);
  expect(durable.text).toContain("before attachment");
  expect(durable.text).toContain("/a.ts");
});

it("waits for a picker accepted before transfer and rejects new attachment actions while frozen", async () => {
  const selection = Promise.withResolvers<{ ok: true; paths: string[] }>();
  pick.mockReturnValue(selection.promise);
  const hook = composer();
  act(() => hook.result.current.pickFiles());
  let flushed = false;
  act(() => freezeTerminalDraft("p", true));
  const flush = flushTerminalDraft("p").then(() => {
    flushed = true;
  });
  act(() => hook.result.current.pickFiles());
  expect(pick).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(flushed).toBe(false);
  await act(async () => {
    selection.resolve({ ok: true, paths: ["/a.ts"] });
    await flush;
  });
  expect(durable.composition?.attachments).toMatchObject([{ path: "/a.ts" }]);
  expect(durable.text).toContain("/a.ts");
});

it("flushes every image and the trailing clipboard text, including merges queued after freeze", async () => {
  const first = Promise.withResolvers<unknown>();
  const second = Promise.withResolvers<unknown>();
  materialize
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const hook = composer();
  const files = ["one.png", "two.png"].map((name) => ({
    name,
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(1),
  }));
  const event = {
    preventDefault: vi.fn(),
    clipboardData: { files, items: [], getData: () => "trailing text" },
  } as unknown as ClipboardEvent;
  act(() => hook.result.current.onPaste(event));
  act(() => freezeTerminalDraft("p", true));
  let flushed = false;
  const flush = flushTerminalDraft("p").then(() => {
    flushed = true;
  });
  await vi.waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
  await act(async () => {
    first.resolve({
      ok: true,
      attachment: { id: "1", kind: "image", name: "one.png", path: "/one.png" },
    });
  });
  await vi.waitFor(() => expect(materialize).toHaveBeenCalledTimes(2));
  expect(flushed).toBe(false);
  await act(async () => {
    second.resolve({
      ok: true,
      attachment: { id: "2", kind: "image", name: "two.png", path: "/two.png" },
    });
    await flush;
  });
  expect(durable.composition?.attachments).toHaveLength(2);
  expect(durable.text).toContain("/one.png");
  expect(durable.text).toContain("/two.png");
  expect(durable.text).toContain("trailing text");
});
