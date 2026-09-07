import {
  emptyTerminalDraft,
  type TerminalDraft,
  type TerminalDraftWrite,
  terminalDraftSchema,
} from "@shared/contracts/terminal/draft.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptTerminalDraft,
  flushTerminalDraft,
  freezeTerminalDraft,
  hydrateTerminalDraft,
  readTerminalDraftText,
  resetTerminalDraftMirrorsForTests,
  useTerminalDraftStore,
  writeTerminalDraftComposition,
  writeTerminalDraftText,
} from "@/stores/terminal-drafts.store.ts";

beforeEach(() => resetTerminalDraftMirrorsForTests());
describe("composer durable draft mirror", () => {
  it("settles a rich draft after IPC schema normalization reorders its fields", async () => {
    let durable = emptyTerminalDraft();
    const writeDraft = vi.fn(
      async (_panelId: string, input: TerminalDraftWrite) => {
        if (writeDraft.mock.calls.length > 3)
          throw new Error("draft write loop");
        durable = terminalDraftSchema.parse({
          ...durable,
          ...input,
          revision: durable.revision + 1,
        });
        return durable;
      }
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { readDraft: async () => durable, writeDraft } },
    });
    await hydrateTerminalDraft("p");
    writeTerminalDraftComposition("p", {
      attachments: [{ path: "/a.ts", name: "a.ts", kind: "file", id: "a" }],
      editorJson: "{}",
      editorText: "",
    });
    await flushTerminalDraft("p");
    expect(writeDraft).toHaveBeenCalledOnce();
    expect(useTerminalDraftStore.getState().drafts.p?.dirty).toBe(false);
  });
  it("hydrates an unconfirmed send for manual review without submitting it", async () => {
    const sendText = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          sendText,
          readDraft: async () => ({
            ...emptyTerminalDraft(),
            text: "original",
            revision: 2,
            status: "unconfirmed",
          }),
        },
      },
    });
    await hydrateTerminalDraft("p");
    expect(readTerminalDraftText("p")).toBe("original");
    expect(sendText).not.toHaveBeenCalled();
  });
  it("flushes a next edit made while an older write is awaiting acknowledgement", async () => {
    let saved: TerminalDraft = emptyTerminalDraft();
    let release: (() => void) | undefined;
    const writeDraft = vi.fn(
      async (_panel: string, input: { text: string; revision: number }) => {
        if (!release)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        saved = { ...saved, text: input.text, revision: input.revision + 1 };
        return saved;
      }
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { readDraft: async () => saved, writeDraft } },
    });
    await hydrateTerminalDraft("p");
    writeTerminalDraftText("p", "first");
    const flush = flushTerminalDraft("p");
    await vi.waitFor(() => expect(release).toBeDefined());
    writeTerminalDraftText("p", "next");
    release?.();
    await flush;
    expect(saved.text).toBe("next");
    expect(useTerminalDraftStore.getState().drafts.p?.dirty).toBe(false);
  });
  it("keeps the transfer edit lock while accepting a disk receipt", () => {
    freezeTerminalDraft("p", true);
    acceptTerminalDraft("p", {
      ...emptyTerminalDraft(),
      text: "saved",
      revision: 1,
    });
    expect(useTerminalDraftStore.getState().drafts.p?.frozen).toBe(true);
  });
});
