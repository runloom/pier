import { createHash } from "node:crypto";
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
  FileDraftTransferInput,
  FileDraftWriteResult,
} from "./file-drafts-types.ts";

const DEFAULT_MAX_DRAFT_VALUE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ENTRY_VERSION = 1;
const TRANSFER_LOCK_MESSAGE =
  "Draft key is locked by an in-flight panel transfer";

interface StagedTransferDraft {
  checksum: string;
  sourceKey: string;
  targetKey: string;
}

interface StagedTransfer {
  drafts: readonly StagedTransferDraft[];
  sourceOwner: string;
  targetOwner: string;
  transferId: string;
}

export { LEGACY_DRAFT_OWNER } from "./file-drafts-storage.ts";
export type {
  CreateFileDraftsServiceOptions,
  FileDraftClaimResult,
  FileDraftSnapshot,
  FileDraftsService,
  FileDraftTransferInput,
  FileDraftTransferMapping,
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
  /** owner\0key → transferId for target keys locked during stage. */
  readonly #locks = new Map<string, string>();
  readonly #transfers = new Map<string, StagedTransfer>();

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

  commitTransfer(input: FileDraftTransferInput): Promise<void> {
    return this.#enqueue(() => this.#commitTransfer(input));
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

  rollbackTransfer(input: FileDraftTransferInput): Promise<void> {
    return this.#enqueue(() => this.#rollbackTransfer(input));
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

  stageTransfer(input: FileDraftTransferInput): Promise<void> {
    return this.#enqueue(() => this.#stageTransfer(input));
  }

  async #awaitReads(): Promise<void> {
    await this.#ensureInit();
    await this.#operationQueue;
  }

  async #commitTransfer(input: FileDraftTransferInput): Promise<void> {
    const { drafts, sourceOwner, targetOwner, transferId } = input;
    assertDraftOwner(sourceOwner);
    assertDraftOwner(targetOwner);
    assertTransferId(transferId);
    for (const draft of drafts) {
      assertDraftKey(draft.sourceKey);
      assertDraftKey(draft.targetKey);
    }

    const staged = this.#transfers.get(transferId);
    const targetKeys =
      staged?.drafts.map((draft) => draft.targetKey) ??
      drafts.map((draft) => draft.targetKey);
    for (const targetKey of targetKeys) {
      this.#locks.delete(lockKey(targetOwner, targetKey));
    }
    this.#transfers.delete(transferId);

    for (const draft of drafts) {
      await this.#deleteEntryUnchecked(sourceOwner, draft.sourceKey);
    }
  }

  async #deleteEntry(owner: string, key: string): Promise<boolean> {
    assertDraftOwner(owner);
    assertDraftKey(key);
    this.#assertUnlocked(owner, key);
    return this.#deleteEntryUnchecked(owner, key);
  }

  async #deleteEntryUnchecked(owner: string, key: string): Promise<boolean> {
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

  async #rollbackTransfer(input: FileDraftTransferInput): Promise<void> {
    const { drafts, sourceOwner, targetOwner, transferId } = input;
    assertDraftOwner(sourceOwner);
    assertDraftOwner(targetOwner);
    assertTransferId(transferId);
    for (const draft of drafts) {
      assertDraftKey(draft.sourceKey);
      assertDraftKey(draft.targetKey);
    }

    const staged = this.#transfers.get(transferId);
    const stagedByTarget = new Map(
      (staged?.drafts ?? []).map((draft) => [draft.targetKey, draft])
    );

    for (const draft of drafts) {
      const stagedDraft = stagedByTarget.get(draft.targetKey);
      const target = this.#entry(targetOwner, draft.targetKey);
      if (target && stagedDraft) {
        const checksum = checksumOf(target.value);
        if (checksum === stagedDraft.checksum) {
          await this.#deleteEntryUnchecked(targetOwner, draft.targetKey);
        }
      }
      await this.#deleteEntryUnchecked(sourceOwner, draft.sourceKey);
      this.#locks.delete(lockKey(targetOwner, draft.targetKey));
    }

    this.#transfers.delete(transferId);
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
    this.#assertUnlocked(owner, key);
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
      version: ENTRY_VERSION,
    };
    await this.#storage.write(owner, entry);
    ownerEntries(this.#entries, owner).set(key, entry);
    this.#totalBytes = this.#totalBytes - (current?.bytes ?? 0) + bytes;
    await this.#storage.refreshIndexCache(this.#entries);
    return storedResult(entry);
  }

  async #stageTransfer(input: FileDraftTransferInput): Promise<void> {
    const { drafts, sourceOwner, targetOwner, transferId } = input;
    assertDraftOwner(sourceOwner);
    assertDraftOwner(targetOwner);
    assertTransferId(transferId);
    if (this.#transfers.has(transferId)) {
      throw new Error(`Transfer ${transferId} is already staged`);
    }

    const prepared: StagedTransferDraft[] = [];
    let addedBytes = 0;
    const seenTargets = new Set<string>();
    const seenSources = new Set<string>();

    for (const draft of drafts) {
      assertDraftKey(draft.sourceKey);
      assertDraftKey(draft.targetKey);
      if (seenSources.has(draft.sourceKey)) {
        throw new Error(`Duplicate transfer source key: ${draft.sourceKey}`);
      }
      if (seenTargets.has(draft.targetKey)) {
        throw new Error(`Duplicate transfer target key: ${draft.targetKey}`);
      }
      seenSources.add(draft.sourceKey);
      seenTargets.add(draft.targetKey);

      const source = this.#entry(sourceOwner, draft.sourceKey);
      if (!source) {
        throw new Error(
          `Transfer source draft missing: ${sourceOwner}/${draft.sourceKey}`
        );
      }
      if (this.#entry(targetOwner, draft.targetKey)) {
        throw new Error(
          `Transfer target draft already exists: ${targetOwner}/${draft.targetKey}`
        );
      }
      if (this.#locks.has(lockKey(targetOwner, draft.targetKey))) {
        throw new Error(
          `Transfer target draft is locked: ${targetOwner}/${draft.targetKey}`
        );
      }
      addedBytes += source.bytes;
      prepared.push({
        checksum: checksumOf(source.value),
        sourceKey: draft.sourceKey,
        targetKey: draft.targetKey,
      });
    }

    if (this.#totalBytes + addedBytes > this.#maxTotalBytes) {
      throw new Error("Transfer would exceed draft quota");
    }

    const written: string[] = [];
    try {
      for (const draft of prepared) {
        const source = this.#entry(sourceOwner, draft.sourceKey);
        if (!source) {
          throw new Error(
            `Transfer source draft missing: ${sourceOwner}/${draft.sourceKey}`
          );
        }
        const entry: StoredDraftEntry = {
          bytes: source.bytes,
          generation: source.generation,
          key: draft.targetKey,
          updatedAt: Date.now(),
          value: source.value,
          version: ENTRY_VERSION,
        };
        await this.#storage.write(targetOwner, entry);
        ownerEntries(this.#entries, targetOwner).set(draft.targetKey, entry);
        this.#totalBytes += entry.bytes;
        written.push(draft.targetKey);
        this.#locks.set(lockKey(targetOwner, draft.targetKey), transferId);
      }
      await this.#storage.refreshIndexCache(this.#entries);
      this.#transfers.set(transferId, {
        drafts: prepared,
        sourceOwner,
        targetOwner,
        transferId,
      });
    } catch (error) {
      for (const targetKey of written) {
        this.#locks.delete(lockKey(targetOwner, targetKey));
        await this.#deleteEntryUnchecked(targetOwner, targetKey);
      }
      throw error;
    }
  }

  #assertUnlocked(owner: string, key: string): void {
    if (this.#locks.has(lockKey(owner, key))) {
      throw new Error(TRANSFER_LOCK_MESSAGE);
    }
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

function assertTransferId(transferId: string): void {
  if (!transferId) {
    throw new Error("Transfer id must not be empty");
  }
}

function checksumOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function lockKey(owner: string, key: string): string {
  return `${owner}\0${key}`;
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
