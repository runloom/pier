import { join } from "node:path";
import { app } from "electron";
import { createTerminalDraftStore } from "./store.ts";

let store: ReturnType<typeof createTerminalDraftStore> | undefined;
export function terminalDraftStore() {
  store ??= createTerminalDraftStore(
    join(app.getPath("userData"), "terminal-unsent-drafts.json")
  );
  return store;
}
export async function flushTerminalDrafts(): Promise<void> {
  await store?.flush();
}
