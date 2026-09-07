import {
  emptyTerminalDraft,
  type TerminalDraft,
  type TerminalDraftComposition,
  terminalDraftCompositionKey,
} from "@shared/contracts/terminal/draft.ts";
import i18next from "i18next";
import { create } from "zustand";
import { showAppAlert } from "./app-dialog.store.ts";

interface DraftMirror {
  composition?: TerminalDraftComposition | undefined;
  dirty: boolean;
  durable: TerminalDraft;
  frozen?: boolean | undefined;
  loaded: boolean;
  value: string;
}
export const useTerminalDraftStore = create<{
  drafts: Record<string, DraftMirror>;
}>(() => ({ drafts: {} }));
const loading = new Map<string, Promise<void>>();
const saving = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const mutations = new Map<string, Set<Promise<void>>>();
const forgotten = new Set<string>();
let subscribers = 0;
let unsubscribe: (() => void) | undefined;

function mirror(panelId: string): DraftMirror {
  return (
    useTerminalDraftStore.getState().drafts[panelId] ?? {
      durable: emptyTerminalDraft(),
      value: "",
      dirty: false,
      loaded: false,
    }
  );
}
function setMirror(panelId: string, value: DraftMirror): void {
  useTerminalDraftStore.setState((state) => ({
    drafts: { ...state.drafts, [panelId]: value },
  }));
}
export function acceptTerminalDraft(
  panelId: string,
  draft: TerminalDraft
): void {
  if (forgotten.has(panelId)) return;
  const previous = mirror(panelId);
  if (draft.revision < previous.durable.revision) return;
  let value = previous.dirty ? previous.value : draft.text;
  // Initial tasks may arrive while the user is already typing. Preserve both.
  if (
    previous.dirty &&
    draft.seedId &&
    draft.seedId !== previous.durable.seedId &&
    draft.text !== previous.value
  ) {
    const added = draft.text.startsWith(previous.durable.text)
      ? draft.text.slice(previous.durable.text.length).trimStart()
      : draft.text;
    value = [previous.value, added].filter(Boolean).join("\n\n");
  }
  setMirror(panelId, {
    frozen: previous.frozen,
    durable: draft,
    value,
    composition: previous.dirty ? previous.composition : draft.composition,
    dirty:
      value !== draft.text ||
      terminalDraftCompositionKey(
        previous.dirty ? previous.composition : draft.composition
      ) !== terminalDraftCompositionKey(draft.composition),
    loaded: true,
  });
}
export function freezeTerminalDraft(panelId: string, frozen: boolean): void {
  setMirror(panelId, { ...mirror(panelId), frozen });
}

/** Track a whole accepted attachment operation, including picker and all images. */
export function runTerminalDraftMutation(
  panelId: string,
  operation: () => void | Promise<void>
): Promise<void> {
  if (forgotten.has(panelId) || mirror(panelId).frozen)
    return Promise.resolve();
  const pending = mutations.get(panelId) ?? new Set<Promise<void>>();
  mutations.set(panelId, pending);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  pending.add(promise);
  const finish = () => {
    pending.delete(promise);
    if (pending.size === 0 && mutations.get(panelId) === pending)
      mutations.delete(panelId);
  };
  promise.then(finish, finish);
  try {
    resolve(operation());
  } catch (error) {
    reject(error);
  }
  return promise;
}

export async function waitForTerminalDraftMutations(
  panelId: string
): Promise<void> {
  for (;;) {
    const pending = mutations.get(panelId);
    if (!pending?.size) return;
    await Promise.all(pending);
  }
}
export function readTerminalDraftText(panelId: string): string {
  return mirror(panelId).value;
}

export function hydrateTerminalDraft(panelId: string): Promise<void> {
  if (mirror(panelId).loaded || !window.pier?.terminal?.readDraft)
    return Promise.resolve();
  const pending = loading.get(panelId);
  if (pending) return pending;
  forgotten.delete(panelId);
  const read = window.pier.terminal
    .readDraft(panelId)
    .then((draft) => acceptTerminalDraft(panelId, draft))
    .finally(() => loading.delete(panelId));
  loading.set(panelId, read);
  return read;
}

export function reportTerminalDraftFailure(error: unknown): void {
  showAppAlert({
    title: i18next.t("terminal.composer.draftSaveFailed"),
    body: error instanceof Error ? error.message : String(error),
  });
}

export function flushTerminalDraft(panelId: string): Promise<void> {
  const timer = timers.get(panelId);
  if (timer) clearTimeout(timer);
  timers.delete(panelId);
  const existing = saving.get(panelId);
  if (existing)
    // New attachments can start after the old save passed its barrier. Its ACK
    // may clear dirty before they finish, so always cross the barrier again.
    return existing.then(() => flushTerminalDraft(panelId));
  if (forgotten.has(panelId) || !window.pier?.terminal?.writeDraft)
    return Promise.resolve();
  const run = (async () => {
    await waitForTerminalDraftMutations(panelId);
    await hydrateTerminalDraft(panelId);
    let conflicts = 0;
    while (mirror(panelId).dirty && !forgotten.has(panelId)) {
      const current = mirror(panelId);
      try {
        const saved = await window.pier.terminal.writeDraft(panelId, {
          text: current.value,
          composition: current.composition,
          revision: current.durable.revision,
        });
        acceptTerminalDraft(panelId, saved);
      } catch (error) {
        if (
          !(
            error instanceof Error && error.message.includes("draft changed")
          ) ||
          conflicts++ >= 2
        )
          throw error;
        acceptTerminalDraft(
          panelId,
          await window.pier.terminal.readDraft(panelId)
        );
      }
    }
  })().finally(() => saving.delete(panelId));
  saving.set(panelId, run);
  return run;
}

export function writeTerminalDraftText(panelId: string, value: string): void {
  if (forgotten.has(panelId)) return;
  const current = mirror(panelId);
  if (current.value === value) return;
  setMirror(panelId, {
    ...current,
    value,
    dirty:
      value !== current.durable.text ||
      terminalDraftCompositionKey(current.composition) !==
        terminalDraftCompositionKey(current.durable.composition),
  });
  if (!timers.has(panelId))
    timers.set(
      panelId,
      setTimeout(() => {
        flushTerminalDraft(panelId).catch(reportTerminalDraftFailure);
      }, 150)
    );
}

export async function flushAllTerminalDrafts(): Promise<void> {
  await Promise.all(
    [
      ...new Set([
        ...Object.keys(useTerminalDraftStore.getState().drafts),
        ...mutations.keys(),
      ]),
    ].map(flushTerminalDraft)
  );
}

export function subscribeTerminalDrafts(): () => void {
  if (subscribers++ === 0)
    unsubscribe = window.pier?.terminal?.onDraftChanged?.((event) =>
      acceptTerminalDraft(event.panelId, event.draft)
    );
  return () => {
    if (--subscribers === 0) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };
}

export function forgetTerminalDraft(panelId: string): void {
  forgotten.add(panelId);
  const timer = timers.get(panelId);
  if (timer) clearTimeout(timer);
  timers.delete(panelId);
  const { [panelId]: _removed, ...drafts } =
    useTerminalDraftStore.getState().drafts;
  useTerminalDraftStore.setState({ drafts });
}

export function resetTerminalDraftMirrorsForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  loading.clear();
  saving.clear();
  forgotten.clear();
  mutations.clear();
  useTerminalDraftStore.setState({ drafts: {} });
}

export function readTerminalDraftComposition(
  panelId: string
): TerminalDraftComposition | undefined {
  return mirror(panelId).composition;
}
export function writeTerminalDraftComposition(
  panelId: string,
  patch: Partial<TerminalDraftComposition>
): void {
  if (forgotten.has(panelId)) return;
  const current = mirror(panelId);
  const composition = { ...current.composition, ...patch };
  if (
    terminalDraftCompositionKey(composition) ===
    terminalDraftCompositionKey(current.composition)
  )
    return;
  setMirror(panelId, { ...current, composition, dirty: true });
  if (!timers.has(panelId))
    timers.set(
      panelId,
      setTimeout(() => {
        flushTerminalDraft(panelId).catch(reportTerminalDraftFailure);
      }, 150)
    );
}
