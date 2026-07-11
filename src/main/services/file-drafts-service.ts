import {
  assertDraftOwner,
  FileDraftsStorage,
  LEGACY_DRAFT_OWNER,
  ownerEntries,
  type StoredDraftDiagnostic,
  type StoredDraftEntries,
  type StoredDraftEntry,
} from "./file-drafts-storage.ts";
import type {
  CreateFileDraftsServiceOptions,
  FileDraftClaimResult,
  FileDraftSnapshot,
  FileDraftsService,
  FileDraftWriteResult,
} from "./file-drafts-types.ts";

const DEFAULT_MAX_DRAFT_VALUE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export { LEGACY_DRAFT_OWNER } from "./file-drafts-storage.ts";
export type {
  CreateFileDraftsServiceOptions,
  FileDraftClaimResult,
  FileDraftSnapshot,
  FileDraftsService,
  FileDraftWriteResult,
} from "./file-drafts-types.ts";

class FileDraftsServiceImpl implements FileDraftsService {
  readonly #maxDraftValueBytes: number;
  readonly #maxTotalBytes: number;
  readonly #storage: FileDraftsStorage;
  #entries: StoredDraftEntries = new Map();
  #diagnostics: readonly StoredDraftDiagnostic[] = [];
  #initPromise: Promise<void> | null = null;
  #operationQueue: Promise<void> = Promise.resolve();
  #totalBytes = 0;

  constructor(options: CreateFileDraftsServiceOptions) {
    this.#storage = new FileDraftsStorage(options.userDataDir);
    this.#maxDraftValueBytes =
      options.maxDraftValueBytes ?? DEFAULT_MAX_DRAFT_VALUE_BYTES;
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    assertPositiveLimit("maxDraftValueBytes", this.#maxDraftValueBytes);
    assertPositiveLimit("maxTotalBytes", this.#maxTotalBytes);
  }

  claimLegacy(owner: string, key: string): Promise<FileDraftClaimResult> {
    return this.#enqueue(async () => {
      assertDraftOwner(owner);
      assertDraftKey(key);
      if (owner === LEGACY_DRAFT_OWNER) {
        throw new Error("A legacy draft must be claimed by a window owner");
      }
      const legacy = this.#entry(LEGACY_DRAFT_OWNER, key);
      const target = this.#entry(owner, key);
      if (!legacy) {
        return target
          ? { draft: snapshot(target), kind: "already-claimed" }
          : { kind: "not-found" };
      }
      if (target) {
        return { draft: snapshot(target), kind: "conflict" };
      }

      await this.#storage.claimLegacy(owner, key);
      ownerEntries(this.#entries, LEGACY_DRAFT_OWNER).delete(key);
      ownerEntries(this.#entries, owner).set(key, legacy);
      await this.#storage.refreshIndexCache(this.#entries);
      return { draft: snapshot(legacy), kind: "claimed" };
    });
  }

  delete(owner: string, key: string): Promise<boolean> {
    return this.#enqueue(() => this.#deleteEntry(owner, key));
  }

  async flush(): Promise<void> {
    await this.#ensureInit();
    await this.#operationQueue;
  }

  async get(owner: string, key: string): Promise<FileDraftSnapshot | null> {
    assertDraftOwner(owner);
    assertDraftKey(key);
    await this.#awaitReads();
    const entry = this.#entry(owner, key);
    return entry ? snapshot(entry) : null;
  }

  async listKeys(owner: string): Promise<readonly string[]> {
    assertDraftOwner(owner);
    await this.#awaitReads();
    return [...ownerEntries(this.#entries, owner).keys()].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  async listDiagnostics(owner: string) {
    assertDraftOwner(owner);
    await this.#awaitReads();
    return this.#diagnostics
      .filter((diagnostic) => diagnostic.owner === owner)
      .map(({ id, message, quarantinedAt }) => ({
        id,
        message,
        quarantinedAt,
      }));
  }

  set(
    owner: string,
    key: string,
    generation: number,
    value: string
  ): Promise<FileDraftWriteResult> {
    return this.#enqueue(() =>
      this.#setEntry(owner, key, generation, value)
    ).catch(
      (error: unknown): FileDraftWriteResult => ({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }

  async #awaitReads(): Promise<void> {
    await this.#ensureInit();
    await this.#operationQueue;
  }

  async #deleteEntry(owner: string, key: string): Promise<boolean> {
    assertDraftOwner(owner);
    assertDraftKey(key);
    const entry = this.#entry(owner, key);
    if (!entry) {
      return false;
    }
    await this.#storage.delete(owner, key);
    ownerEntries(this.#entries, owner).delete(key);
    this.#totalBytes -= entry.bytes;
    await this.#storage.refreshIndexCache(this.#entries);
    return true;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationQueue
      .catch(() => undefined)
      .then(async () => {
        await this.#ensureInit();
        return operation();
      });
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  #ensureInit(): Promise<void> {
    this.#initPromise ??= this.#initialize();
    return this.#initPromise;
  }

  #entry(owner: string, key: string): StoredDraftEntry | undefined {
    return this.#entries.get(owner)?.get(key);
  }

  async #initialize(): Promise<void> {
    const snapshot = await this.#storage.initialize();
    this.#entries = snapshot.entries;
    this.#diagnostics = snapshot.diagnostics;
    this.#totalBytes = [...this.#entries.values()].reduce(
      (total, entries) =>
        total +
        [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0),
      0
    );
  }

  async #setEntry(
    owner: string,
    key: string,
    generation: number,
    value: string
  ): Promise<FileDraftWriteResult> {
    assertDraftOwner(owner);
    assertDraftKey(key);
    assertGeneration(generation);
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > this.#maxDraftValueBytes) {
      return { kind: "rejected", reason: "entry-too-large" };
    }
    const current = this.#entry(owner, key);
    if (current && generation <= current.generation) {
      if (generation === current.generation && value === current.value) {
        return storedResult(current);
      }
      return { kind: "rejected", reason: "stale-generation" };
    }
    if (
      this.#totalBytes - (current?.bytes ?? 0) + bytes >
      this.#maxTotalBytes
    ) {
      return { kind: "rejected", reason: "quota-exceeded" };
    }

    const entry: StoredDraftEntry = {
      bytes,
      generation,
      key,
      updatedAt: Date.now(),
      value,
      version: 1,
    };
    await this.#storage.write(owner, entry);
    ownerEntries(this.#entries, owner).set(key, entry);
    this.#totalBytes = this.#totalBytes - (current?.bytes ?? 0) + bytes;
    await this.#storage.refreshIndexCache(this.#entries);
    return storedResult(entry);
  }
}

export function createFileDraftsService(
  options: CreateFileDraftsServiceOptions
): FileDraftsService {
  return new FileDraftsServiceImpl(options);
}

function assertDraftKey(key: string): void {
  if (!key) {
    throw new Error("Draft key must not be empty");
  }
}

function assertGeneration(generation: number): void {
  if (!(Number.isSafeInteger(generation) && generation >= 0)) {
    throw new Error("Draft generation must be a non-negative safe integer");
  }
}

function assertPositiveLimit(name: string, value: number): void {
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function snapshot(entry: StoredDraftEntry): FileDraftSnapshot {
  return {
    bytes: entry.bytes,
    generation: entry.generation,
    key: entry.key,
    updatedAt: entry.updatedAt,
    value: entry.value,
  };
}

function storedResult(entry: StoredDraftEntry): FileDraftWriteResult {
  return {
    bytes: entry.bytes,
    generation: entry.generation,
    key: entry.key,
    kind: "stored",
    updatedAt: entry.updatedAt,
  };
}
