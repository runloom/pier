import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  emptyTerminalDraft,
  type TerminalDraft,
  type TerminalDraftWrite,
  terminalDraftCompositionKey,
  terminalDraftSchema,
} from "@shared/contracts/terminal/draft.ts";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";

const stateSchema = z
  .object({
    version: z.literal(1),
    drafts: z.record(z.string(), terminalDraftSchema),
  })
  .strict();
type DraftState = z.infer<typeof stateSchema>;
const keyFor = (windowId: string, panelId: string) =>
  JSON.stringify([windowId, panelId]);
const withoutPending = (draft: TerminalDraft): TerminalDraft => {
  const { pendingSend: _pending, ...rest } = draft;
  return rest;
};
function recoveredText(draft: TerminalDraft): string {
  const pending = draft.pendingSend?.text;
  return pending && draft.text !== pending
    ? [pending, draft.text].filter(Boolean).join("\n\n")
    : draft.text;
}

/** A single main writer. Each acknowledgement follows its atomic disk write. */
export function createTerminalDraftStore(filePath: string) {
  let state: DraftState | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const retiredOwners = new Set<string>();
  async function persist(next: DraftState): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, `${JSON.stringify(next)}\n`, {
      mode: 0o600,
    });
    state = next;
  }
  async function load(): Promise<DraftState> {
    if (state) return state;
    let next: DraftState;
    try {
      next = stateSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
      next = { version: 1, drafts: {} };
    }
    let recovered = false;
    for (const [key, draft] of Object.entries(next.drafts)) {
      if (!draft.pendingSend && draft.status !== "sending") continue;
      next.drafts[key] = {
        ...withoutPending(draft),
        text: recoveredText(draft),
        status: "unconfirmed",
        revision: draft.revision + 1,
      };
      recovered = true;
    }
    if (recovered) await persist(next);
    state = next;
    return next;
  }
  function enqueue<T>(
    task: (current: DraftState) => Promise<T> | T
  ): Promise<T> {
    const result = tail
      .catch(() => undefined)
      .then(async () => task(await load()));
    tail = result;
    return result;
  }
  function assertOwner(key: string): void {
    if (retiredOwners.has(key))
      throw new Error(
        "terminal draft moved or closed; reload its current owner"
      );
  }
  async function replace(
    current: DraftState,
    key: string,
    draft: TerminalDraft
  ): Promise<TerminalDraft> {
    const next = terminalDraftSchema.parse(draft);
    await persist({ ...current, drafts: { ...current.drafts, [key]: next } });
    return structuredClone(next);
  }
  return {
    read(windowId: string, panelId: string): Promise<TerminalDraft> {
      return enqueue((current) =>
        structuredClone(
          current.drafts[keyFor(windowId, panelId)] ?? emptyTerminalDraft()
        )
      );
    },
    write(
      windowId: string,
      panelId: string,
      input: TerminalDraftWrite
    ): Promise<TerminalDraft> {
      return enqueue((current) => {
        const key = keyFor(windowId, panelId);
        assertOwner(key);
        const previous = current.drafts[key] ?? emptyTerminalDraft();
        if (input.revision !== previous.revision)
          throw new Error(
            "terminal draft changed; reload before overwriting it"
          );
        return replace(current, key, {
          ...previous,
          text: input.text,
          composition: input.composition,
          revision: previous.revision + 1,
        });
      });
    },
    seed(
      windowId: string,
      panelId: string,
      text: string,
      seedId: string
    ): Promise<TerminalDraft> {
      return enqueue((current) => {
        const key = keyFor(windowId, panelId);
        retiredOwners.delete(key);
        const previous = current.drafts[key] ?? emptyTerminalDraft();
        if (previous.seedId === seedId) return structuredClone(previous);
        return replace(current, key, {
          ...previous,
          text: [previous.text, text].filter(Boolean).join("\n\n"),
          seedId,
          revision: previous.revision + 1,
        });
      });
    },
    beginSend(
      windowId: string,
      panelId: string,
      text: string
    ): Promise<string> {
      return enqueue(async (current) => {
        const key = keyFor(windowId, panelId);
        assertOwner(key);
        const previous = current.drafts[key] ?? emptyTerminalDraft();
        if (previous.pendingSend)
          throw new Error("a terminal submission is already pending");
        const id = randomUUID();
        await replace(current, key, {
          ...previous,
          text: previous.text || text,
          pendingSend: {
            id,
            text,
            ...(previous.text === text && previous.composition
              ? { composition: previous.composition }
              : {}),
          },
          status: "sending",
          revision: previous.revision + 1,
        });
        return id;
      });
    },
    finishSend(
      windowId: string,
      panelId: string,
      id: string,
      outcome: "submitted" | "not-delivered" | "unconfirmed"
    ): Promise<TerminalDraft> {
      return enqueue((current) => {
        const originalKey = keyFor(windowId, panelId);
        const key =
          current.drafts[originalKey]?.pendingSend?.id === id
            ? originalKey
            : (Object.keys(current.drafts).find(
                (key) => current.drafts[key]?.pendingSend?.id === id
              ) ?? originalKey);
        const previous = current.drafts[key] ?? emptyTerminalDraft();
        if (previous.pendingSend?.id !== id) return structuredClone(previous);
        let text = previous.text;
        const unchanged =
          text === previous.pendingSend.text &&
          terminalDraftCompositionKey(previous.composition) ===
            terminalDraftCompositionKey(previous.pendingSend.composition);
        if (outcome === "submitted" && unchanged) text = "";
        if (outcome !== "submitted") text = recoveredText(previous);
        return replace(current, key, {
          ...withoutPending(previous),
          ...(outcome === "submitted" && unchanged
            ? { composition: undefined, seedId: undefined }
            : {}),
          text,
          status: outcome === "unconfirmed" ? "unconfirmed" : "draft",
          revision: previous.revision + 1,
        });
      });
    },
    reopen(windowId: string, panelId: string): void {
      retiredOwners.delete(keyFor(windowId, panelId));
    },
    move(source: string, target: string, panelId: string): Promise<void> {
      return enqueue(async (current) => {
        if (source === target) return;
        const sourceKey = keyFor(source, panelId),
          targetKey = keyFor(target, panelId);
        const drafts = { ...current.drafts };
        if (drafts[sourceKey]) {
          if (drafts[targetKey]?.text)
            throw new Error("target terminal already has an unsent draft");
          drafts[targetKey] = drafts[sourceKey];
          delete drafts[sourceKey];
        }
        await persist({ ...current, drafts });
        retiredOwners.add(sourceKey);
        retiredOwners.delete(targetKey);
      });
    },
    remove(windowId: string, panelId: string): Promise<void> {
      return enqueue(async (current) => {
        const key = keyFor(windowId, panelId);
        const drafts = { ...current.drafts };
        delete drafts[key];
        await persist({ ...current, drafts });
        retiredOwners.add(key);
      });
    },
    flush: () => tail.then(() => undefined),
  };
}
