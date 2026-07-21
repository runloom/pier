import {
  ingestFilesDraftSnapshots,
  peekFilesDraftBackend,
  readFilesDraftRecord,
} from "./files-draft-client-store.ts";

/**
 * Ensure a draft key is present in the client cache by reading it from the
 * backend. Does not create a second writer — get + hydrate only.
 */
export async function hydrateFilesDraftRecordFromBackend(
  key: string
): Promise<string | null> {
  const cached = readFilesDraftRecord(key);
  if (cached !== null) {
    return cached;
  }
  const backend = peekFilesDraftBackend();
  if (!backend) {
    return null;
  }
  const snapshot = await backend.get(key);
  if (!snapshot) {
    return null;
  }
  ingestFilesDraftSnapshots([snapshot]);
  return snapshot.value;
}

export async function claimLegacyDraft(key: string): Promise<boolean> {
  const backend = peekFilesDraftBackend();
  if (!backend) {
    return false;
  }
  const result = await backend.claimLegacy(key);
  if (result.kind === "not-found") {
    return false;
  }
  ingestFilesDraftSnapshots([result.draft]);
  return true;
}
