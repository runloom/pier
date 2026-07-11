import {
  FILE_WRITE_COMMIT_RECEIPT_STORAGE_PREFIX,
  type FileDraftSnapshot,
} from "@shared/contracts/file.ts";
import {
  CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX,
  DISK_DRAFT_STORAGE_PREFIX,
  SAVE_AS_OPERATION_STORAGE_PREFIX,
  UNTITLED_DRAFT_STORAGE_PREFIX,
} from "./files-document-draft-records.ts";
import type {
  FilesDraftBackend,
  FilesDraftProtectionState,
} from "./files-draft-client-types.ts";
import {
  emergencyDraftEntries,
  readEmergencyDraft,
  removeEmergencyDraft,
  writeEmergencyDraft,
} from "./files-draft-emergency-storage.ts";

export type {
  FilesDraftBackend,
  FilesDraftProtectionState,
} from "./files-draft-client-types.ts";

const DELETED_DRAFT_VALUE = "__pier_files_deleted_draft_v1__";
const DRAFT_WRITE_DEBOUNCE_MS = 350;

const IDLE_DRAFT_PROTECTION = { status: "idle" } as const;

let draftBackend: FilesDraftBackend | null = null;
const hydratedDrafts = new Map<string, string>();
let draftsHydrated = false;
const draftGenerations = new Map<string, number>();
const draftProtection = new Map<string, FilesDraftProtectionState>();
const draftProtectionListeners = new Set<() => void>();
const deferredWrites = new Map<string, { generation: number; value: string }>();
const pendingOperations = new Set<Promise<void>>();
const scheduledWrites = new Map<
  string,
  {
    generation: number;
    timer: ReturnType<typeof setTimeout>;
    value: string;
  }
>();
let writesSuspended = false;

function setDraftProtection(
  key: string,
  state: FilesDraftProtectionState | null
): void {
  if (state) {
    draftProtection.set(key, state);
  } else {
    draftProtection.delete(key);
  }
  for (const listener of draftProtectionListeners) {
    listener();
  }
}

function readDraftValue(key: string): string | null {
  if (hydratedDrafts.has(key)) {
    const value = hydratedDrafts.get(key) ?? null;
    return value === DELETED_DRAFT_VALUE ? null : value;
  }
  if (draftBackend && draftsHydrated) {
    return null;
  }
  const value = readEmergencyDraft(key);
  return value === DELETED_DRAFT_VALUE ? null : value;
}

function writeDraftValue(key: string, value: string): void {
  if (readDraftValue(key) === value) {
    return;
  }
  hydratedDrafts.set(key, value);
  const generation = (draftGenerations.get(key) ?? 0) + 1;
  draftGenerations.set(key, generation);
  writeEmergencyDraft(key, value);
  if (writesSuspended) {
    deferredWrites.set(key, { generation, value });
    setDraftProtection(key, {
      generation,
      message: "Draft changed while file persistence was suspended",
      status: "failed",
    });
    return;
  }
  if (draftBackend) {
    scheduleBackendWrite(draftBackend, key, generation, value);
    return;
  }
  setDraftProtection(key, {
    generation,
    message: "Draft persistence backend is unavailable",
    status: "failed",
  });
}

function scheduleBackendWrite(
  backend: FilesDraftBackend,
  key: string,
  generation: number,
  value: string
): void {
  const scheduled = scheduledWrites.get(key);
  if (scheduled) {
    clearTimeout(scheduled.timer);
  }
  setDraftProtection(key, { generation, status: "protecting" });
  const timer = setTimeout(() => {
    const current = scheduledWrites.get(key);
    if (current?.generation !== generation) {
      return;
    }
    scheduledWrites.delete(key);
    startBackendWrite(backend, key, generation, value);
  }, DRAFT_WRITE_DEBOUNCE_MS);
  scheduledWrites.set(key, { generation, timer, value });
}

function publishScheduledWrites(): void {
  const backend = draftBackend;
  if (!backend) {
    return;
  }
  for (const [key, scheduled] of scheduledWrites) {
    clearTimeout(scheduled.timer);
    scheduledWrites.delete(key);
    startBackendWrite(backend, key, scheduled.generation, scheduled.value);
  }
}

function startBackendWrite(
  backend: FilesDraftBackend,
  key: string,
  generation: number,
  value: string
): void {
  setDraftProtection(key, { generation, status: "protecting" });
  const operation = backend
    .set(key, generation, value)
    .then((result) => {
      if (draftGenerations.get(key) !== generation) {
        return;
      }
      if (result.kind === "stored") {
        setDraftProtection(key, {
          generation,
          status: "protected",
          updatedAt: result.updatedAt,
        });
        removeEmergencyDraft(key);
        return;
      }
      const message =
        result.kind === "failed"
          ? result.message
          : `Draft write rejected: ${result.reason}`;
      setDraftProtection(key, { generation, message, status: "failed" });
    })
    .catch((error: unknown) => {
      if (draftGenerations.get(key) === generation) {
        setDraftProtection(key, {
          generation,
          message: error instanceof Error ? error.message : String(error),
          status: "failed",
        });
      }
    })
    .finally(() => {
      pendingOperations.delete(operation);
    });
  pendingOperations.add(operation);
}

function deleteDraftValue(key: string): void {
  const scheduled = scheduledWrites.get(key);
  if (scheduled) {
    clearTimeout(scheduled.timer);
    scheduledWrites.delete(key);
  }
  if (draftBackend) {
    hydratedDrafts.set(key, DELETED_DRAFT_VALUE);
    const operation = draftBackend
      .delete(key)
      .then(() => {
        if (hydratedDrafts.get(key) === DELETED_DRAFT_VALUE) {
          hydratedDrafts.delete(key);
          setDraftProtection(key, null);
          deferredWrites.delete(key);
          removeEmergencyDraft(key);
        }
      })
      .catch((error: unknown) => {
        if (hydratedDrafts.get(key) !== DELETED_DRAFT_VALUE) {
          return;
        }
        writeEmergencyDraft(key, DELETED_DRAFT_VALUE);
        const generation = draftGenerations.get(key) ?? 0;
        setDraftProtection(key, {
          generation,
          message: error instanceof Error ? error.message : String(error),
          status: "failed",
        });
      })
      .finally(() => {
        pendingOperations.delete(operation);
      });
    pendingOperations.add(operation);
    return;
  }
  hydratedDrafts.delete(key);
  removeEmergencyDraft(key);
}

function draftKeysWithPrefix(prefix: string): string[] {
  const keys = new Set<string>();
  for (const key of hydratedDrafts.keys()) {
    if (key.startsWith(prefix)) {
      keys.add(key);
    }
  }
  if (!(draftBackend && draftsHydrated)) {
    for (const [key] of emergencyDraftEntries()) {
      if (key.startsWith(prefix)) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

function isDraftStorageKey(key: string | null): key is string {
  return (
    key?.startsWith(UNTITLED_DRAFT_STORAGE_PREFIX) === true ||
    key?.startsWith(DISK_DRAFT_STORAGE_PREFIX) === true ||
    key?.startsWith(CORRUPT_DOCUMENT_DRAFT_STORAGE_PREFIX) === true ||
    key?.startsWith(SAVE_AS_OPERATION_STORAGE_PREFIX) === true ||
    key?.startsWith(FILE_WRITE_COMMIT_RECEIPT_STORAGE_PREFIX) === true
  );
}

function hydrateBackendDrafts(persisted: readonly FileDraftSnapshot[]): void {
  for (const { generation, key, value } of persisted) {
    draftGenerations.set(key, generation);
    if (!hydratedDrafts.has(key)) {
      hydratedDrafts.set(key, value);
    }
  }
}

function retryBackendDeleteForTombstone(
  backend: FilesDraftBackend,
  key: string
): void {
  hydratedDrafts.set(key, DELETED_DRAFT_VALUE);
  backend
    .delete(key)
    .then(() => {
      if (hydratedDrafts.get(key) === DELETED_DRAFT_VALUE) {
        hydratedDrafts.delete(key);
      }
      removeEmergencyDraft(key);
    })
    .catch(() => undefined);
}

function migrateLocalDraftsToBackend(backend: FilesDraftBackend): void {
  for (const [key, value] of emergencyDraftEntries()) {
    if (!isDraftStorageKey(key)) {
      continue;
    }
    if (value === DELETED_DRAFT_VALUE) {
      retryBackendDeleteForTombstone(backend, key);
      continue;
    }
    hydratedDrafts.set(key, value);
    const generation = (draftGenerations.get(key) ?? 0) + 1;
    draftGenerations.set(key, generation);
    startBackendWrite(backend, key, generation, value);
  }
}

export async function configureFilesDraftBackend(
  backend: FilesDraftBackend
): Promise<void> {
  try {
    const keys = await backend.listKeys();
    const persisted = (
      await Promise.all(keys.map((key) => backend.get(key)))
    ).filter((draft): draft is FileDraftSnapshot => draft !== null);
    hydrateBackendDrafts(persisted);
    migrateLocalDraftsToBackend(backend);
    draftBackend = backend;
    draftsHydrated = true;
  } catch (error) {
    draftBackend = null;
    draftsHydrated = false;
    throw new Error("Unable to load protected file drafts", { cause: error });
  }
}

export function resetFilesDraftBackendForTests(): void {
  draftBackend = null;
  draftsHydrated = false;
  hydratedDrafts.clear();
  draftGenerations.clear();
  draftProtection.clear();
  deferredWrites.clear();
  for (const scheduled of scheduledWrites.values()) {
    clearTimeout(scheduled.timer);
  }
  scheduledWrites.clear();
  pendingOperations.clear();
  writesSuspended = false;
  for (const listener of draftProtectionListeners) {
    listener();
  }
}

export function settleDraftIsolationFailure(input: {
  discardQuarantine: boolean;
  originalKey: string;
  quarantineKey: string;
  raw: string;
}): void {
  hydratedDrafts.set(input.originalKey, input.raw);
  draftProtection.delete(input.originalKey);
  removeEmergencyDraft(input.originalKey);
  if (input.discardQuarantine) {
    hydratedDrafts.delete(input.quarantineKey);
    draftProtection.delete(input.quarantineKey);
    removeEmergencyDraft(input.quarantineKey);
  }
  for (const listener of draftProtectionListeners) listener();
}

export function filesDraftProtectionState(
  key: string
): FilesDraftProtectionState {
  return draftProtection.get(key) ?? IDLE_DRAFT_PROTECTION;
}

export function subscribeFilesDraftProtection(
  listener: () => void
): () => void {
  draftProtectionListeners.add(listener);
  return () => {
    draftProtectionListeners.delete(listener);
  };
}

async function waitForDraftOperations(
  operations: Promise<unknown>,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    throw new DOMException("Draft flush aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Draft flush aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operations.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

export async function flushFilesDraftWrites(
  signal?: AbortSignal
): Promise<void> {
  while (scheduledWrites.size > 0 || pendingOperations.size > 0) {
    publishScheduledWrites();
    if (signal?.aborted) {
      throw new DOMException("Draft flush aborted", "AbortError");
    }
    const current = Promise.allSettled([...pendingOperations]);
    if (signal) {
      await waitForDraftOperations(current, signal);
    } else {
      await current;
    }
  }
  const failures = [...draftProtection.entries()].flatMap(([key, state]) =>
    state.status === "failed" ? [`${key}: ${state.message}`] : []
  );
  if (failures.length > 0) {
    throw new Error(`Draft protection failed: ${failures.join("; ")}`);
  }
}

export async function prepareFilesDraftSuspend(
  signal: AbortSignal
): Promise<void> {
  writesSuspended = true;
  try {
    await flushFilesDraftWrites(signal);
  } catch (error) {
    writesSuspended = false;
    throw error;
  }
}

export function resumeFilesDraftWrites(): void {
  writesSuspended = false;
  publishDeferredWrites();
}

function publishDeferredWrites(): void {
  const backend = draftBackend;
  if (!backend) {
    return;
  }
  for (const [key, { generation, value }] of deferredWrites) {
    startBackendWrite(backend, key, generation, value);
  }
  deferredWrites.clear();
}

export async function commitFilesDraftSuspend(
  signal?: AbortSignal
): Promise<void> {
  while (true) {
    publishDeferredWrites();
    try {
      await flushFilesDraftWrites(signal);
    } catch (error) {
      if (deferredWrites.size === 0) {
        throw error;
      }
      continue;
    }
    if (deferredWrites.size === 0) {
      return;
    }
  }
}

export async function abortFilesDraftSuspend(
  signal?: AbortSignal
): Promise<void> {
  resumeFilesDraftWrites();
  await flushFilesDraftWrites(signal);
}

export function releaseFilesDraftSuspendAfterDispose(): void {
  writesSuspended = false;
  deferredWrites.clear();
}

export async function claimLegacyDraft(key: string): Promise<boolean> {
  const backend = draftBackend;
  if (!backend) {
    return false;
  }
  const result = await backend.claimLegacy(key);
  if (result.kind === "not-found") {
    return false;
  }
  hydrateBackendDrafts([result.draft]);
  return true;
}

export function readFilesDraftRecord(key: string): string | null {
  return readDraftValue(key);
}

export function persistFilesDraftRecord(key: string, value: string): void {
  writeDraftValue(key, value);
}

export function removeFilesDraftRecord(key: string): void {
  deleteDraftValue(key);
}

export function listFilesDraftRecords(prefix: string): readonly string[] {
  return draftKeysWithPrefix(prefix);
}
