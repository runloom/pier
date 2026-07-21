import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import {
  ensurePrivateDirectory,
  pathExists,
  syncDirectory,
  writeDurableJson,
} from "../state/durable-json-io.ts";

const STORE_VERSION = 2;
const ENTRY_VERSION = 1;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const LEGACY_DRAFT_OWNER = "legacy-unassigned";

export interface StoredDraftEntry {
  bytes: number;
  generation: number;
  key: string;
  updatedAt: number;
  value: string;
  version: typeof ENTRY_VERSION;
}

export type StoredDraftEntries = Map<string, Map<string, StoredDraftEntry>>;

export interface StoredDraftDiagnostic {
  id: string;
  message: string;
  owner: string;
  quarantinedAt: number;
}

export interface FileDraftsStorageSnapshot {
  diagnostics: readonly StoredDraftDiagnostic[];
  entries: StoredDraftEntries;
}

interface DraftIndexEntry {
  bytes: number;
  generation: number;
  keyHash: string;
  owner: string;
  updatedAt: number;
}

export class FileDraftsStorage {
  readonly #draftsDir: string;
  readonly #entriesDir: string;
  readonly #indexPath: string;
  readonly #legacyBackupPath: string;
  readonly #legacyPath: string;
  readonly #quarantineDir: string;
  readonly #userDataDir: string;

  constructor(userDataDir: string) {
    this.#userDataDir = userDataDir;
    this.#draftsDir = join(userDataDir, "file-drafts");
    this.#entriesDir = join(this.#draftsDir, "entries");
    this.#indexPath = join(this.#draftsDir, "index.json");
    this.#legacyPath = join(userDataDir, "file-drafts.json");
    this.#quarantineDir = join(this.#draftsDir, "quarantine");
    this.#legacyBackupPath = join(
      userDataDir,
      "file-drafts.legacy-migrated.json"
    );
  }

  async claimLegacy(owner: string, key: string): Promise<void> {
    const targetDir = await this.#ensureOwnerDir(owner);
    const legacyDir = await this.#ensureOwnerDir(LEGACY_DRAFT_OWNER);
    await rename(
      this.#entryPath(LEGACY_DRAFT_OWNER, key),
      this.#entryPath(owner, key)
    );
    await syncDirectory(targetDir);
    await syncDirectory(legacyDir);
  }

  async delete(owner: string, key: string): Promise<void> {
    await this.#ensureOwnerDir(owner);
    await unlink(this.#entryPath(owner, key));
    await syncDirectory(this.#ownerDir(owner));
  }

  async initialize(): Promise<FileDraftsStorageSnapshot> {
    await ensurePrivateDirectory(this.#draftsDir);
    await ensurePrivateDirectory(this.#entriesDir);
    await ensurePrivateDirectory(this.#quarantineDir);
    const { diagnostics, entries } = await this.#scanEntries();
    await this.#migrateLegacyStore(entries);
    await this.refreshIndexCache(entries);
    return { diagnostics, entries };
  }

  async refreshIndexCache(entries: StoredDraftEntries): Promise<void> {
    try {
      await this.#writeIndex(entries);
    } catch (error) {
      // index.json 不是恢复事实源；条目已提交时不能把缓存失败误报成草稿丢失。
      console.warn("[file-drafts] failed to refresh rebuildable index:", error);
    }
  }

  async write(owner: string, entry: StoredDraftEntry): Promise<void> {
    await this.#ensureOwnerDir(owner);
    await writeDurableJson(this.#entryPath(owner, entry.key), entry);
  }

  async #availableLegacyBackupPath(): Promise<string> {
    if (!(await pathExists(this.#legacyBackupPath))) {
      return this.#legacyBackupPath;
    }
    return join(
      this.#userDataDir,
      `file-drafts.legacy-migrated-${Date.now()}-${randomUUID()}.json`
    );
  }

  async #ensureOwnerDir(owner: string): Promise<string> {
    const ownerDir = this.#ownerDir(owner);
    await ensurePrivateDirectory(ownerDir);
    return ownerDir;
  }

  #entryPath(owner: string, key: string): string {
    return join(this.#ownerDir(owner), `${hashKey(key)}.json`);
  }

  async #migrateLegacyStore(entries: StoredDraftEntries): Promise<void> {
    if (!(await pathExists(this.#legacyPath))) {
      return;
    }
    const metadata = await lstat(this.#legacyPath);
    if (!(metadata.isFile() && !metadata.isSymbolicLink())) {
      throw new Error("Legacy file draft store is not a regular file");
    }
    await chmod(this.#legacyPath, 0o600);
    const legacy = parseLegacyStore(await readFile(this.#legacyPath, "utf8"));
    const legacyEntries = ownerEntries(entries, LEGACY_DRAFT_OWNER);
    for (const [key, value] of Object.entries(legacy)) {
      if (legacyEntries.has(key)) {
        continue;
      }
      const entry: StoredDraftEntry = {
        bytes: Buffer.byteLength(value, "utf8"),
        generation: 0,
        key,
        updatedAt: Date.now(),
        value,
        version: ENTRY_VERSION,
      };
      await this.write(LEGACY_DRAFT_OWNER, entry);
      legacyEntries.set(key, entry);
    }

    const backupPath = await this.#availableLegacyBackupPath();
    await rename(this.#legacyPath, backupPath);
    await chmod(backupPath, 0o600);
    await syncDirectory(this.#userDataDir);
  }

  #ownerDir(owner: string): string {
    return join(this.#entriesDir, owner);
  }

  async #scanEntries(): Promise<FileDraftsStorageSnapshot> {
    const entries: StoredDraftEntries = new Map();
    const diagnostics: StoredDraftDiagnostic[] = [];
    const owners = await readdir(this.#entriesDir, { withFileTypes: true });
    for (const ownerDirectory of owners) {
      if (
        !(
          ownerDirectory.isDirectory() &&
          OWNER_PATTERN.test(ownerDirectory.name)
        )
      ) {
        continue;
      }
      const owner = ownerDirectory.name;
      const ownerDir = this.#ownerDir(owner);
      await ensurePrivateDirectory(ownerDir);
      const files = await readdir(ownerDir, { withFileTypes: true });
      for (const file of files) {
        if (!file.name.endsWith(".json")) {
          continue;
        }
        const filePath = join(ownerDir, file.name);
        try {
          if (!file.isFile()) {
            throw new Error("entry is not a regular file");
          }
          const entry = await readStoredEntry(filePath);
          if (basename(filePath) !== `${hashKey(entry.key)}.json`) {
            throw new Error("filename does not match its protected key");
          }
          await chmod(filePath, 0o600);
          ownerEntries(entries, owner).set(entry.key, entry);
        } catch (error) {
          const quarantinedAt = Date.now();
          const id = `${quarantinedAt}-${randomUUID()}-${file.name}`;
          let renamed = false;
          try {
            const quarantineOwnerDir = join(this.#quarantineDir, owner);
            await ensurePrivateDirectory(quarantineOwnerDir);
            const quarantinePath = join(quarantineOwnerDir, id);
            await rename(filePath, quarantinePath);
            renamed = true;
            if (file.isFile()) await chmod(quarantinePath, 0o600);
            await syncDirectory(ownerDir);
            await syncDirectory(quarantineOwnerDir);
          } catch (quarantineError) {
            if (!renamed) {
              diagnostics.push({
                id: `pending-${file.name}`,
                message: `Protected draft could not be recovered or isolated: ${error instanceof Error ? error.message : String(error)}; ${quarantineError instanceof Error ? quarantineError.message : String(quarantineError)}`,
                owner,
                quarantinedAt,
              });
            }
          }
        }
      }
    }
    const quarantinedDiagnostics = await this.#scanQuarantineDiagnostics();
    return {
      diagnostics: [
        ...new Map(
          [...diagnostics, ...quarantinedDiagnostics].map((diagnostic) => [
            `${diagnostic.owner}/${diagnostic.id}`,
            diagnostic,
          ])
        ).values(),
      ],
      entries,
    };
  }

  async #scanQuarantineDiagnostics(): Promise<StoredDraftDiagnostic[]> {
    const diagnostics: StoredDraftDiagnostic[] = [];
    const owners = await readdir(this.#quarantineDir, { withFileTypes: true });
    for (const ownerDirectory of owners) {
      if (
        !(
          ownerDirectory.isDirectory() &&
          OWNER_PATTERN.test(ownerDirectory.name)
        )
      ) {
        continue;
      }
      const owner = ownerDirectory.name;
      const items = await readdir(join(this.#quarantineDir, owner), {
        withFileTypes: true,
      });
      for (const item of items) {
        const timestamp = Number.parseInt(item.name.split("-")[0] ?? "", 10);
        diagnostics.push({
          id: item.name,
          message: `Protected draft remains isolated for manual recovery: ${item.name}`,
          owner,
          quarantinedAt: Number.isFinite(timestamp) ? timestamp : 0,
        });
      }
    }
    return diagnostics;
  }

  async #writeIndex(entries: StoredDraftEntries): Promise<void> {
    const indexEntries: DraftIndexEntry[] = [];
    for (const [owner, drafts] of entries) {
      for (const entry of drafts.values()) {
        indexEntries.push({
          bytes: entry.bytes,
          generation: entry.generation,
          keyHash: hashKey(entry.key),
          owner,
          updatedAt: entry.updatedAt,
        });
      }
    }
    indexEntries.sort((a, b) =>
      `${a.owner}/${a.keyHash}`.localeCompare(`${b.owner}/${b.keyHash}`)
    );
    await writeDurableJson(this.#indexPath, {
      entries: indexEntries,
      generatedAt: Date.now(),
      version: STORE_VERSION,
    });
  }
}

export function assertDraftOwner(owner: string): void {
  if (!OWNER_PATTERN.test(owner)) {
    throw new Error("Invalid draft owner");
  }
}

export function ownerEntries(
  entries: StoredDraftEntries,
  owner: string
): Map<string, StoredDraftEntry> {
  let drafts = entries.get(owner);
  if (!drafts) {
    drafts = new Map();
    entries.set(owner, drafts);
  }
  return drafts;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function isStoredDraftEntry(value: unknown): value is StoredDraftEntry {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const entry = value as Partial<StoredDraftEntry>;
  return (
    entry.version === ENTRY_VERSION &&
    typeof entry.key === "string" &&
    entry.key.length > 0 &&
    typeof entry.value === "string" &&
    Number.isSafeInteger(entry.generation) &&
    (entry.generation ?? -1) >= 0 &&
    Number.isSafeInteger(entry.bytes) &&
    entry.bytes === Buffer.byteLength(entry.value, "utf8") &&
    typeof entry.updatedAt === "number" &&
    Number.isFinite(entry.updatedAt) &&
    entry.updatedAt >= 0
  );
}

function parseLegacyStore(raw: string): Record<string, string> {
  const value: unknown = JSON.parse(raw);
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    throw new Error("Legacy file draft store must be a JSON object");
  }
  const result = Object.create(null) as Record<string, string>;
  for (const [key, draft] of Object.entries(value)) {
    if (!key) {
      throw new Error("Legacy file draft keys must not be empty");
    }
    if (typeof draft !== "string") {
      throw new Error("Legacy file draft values must be strings");
    }
    result[key] = draft;
  }
  return result;
}

async function readStoredEntry(path: string): Promise<StoredDraftEntry> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isStoredDraftEntry(parsed)) {
      throw new Error("entry schema or byte count is invalid");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Unable to recover protected draft entry: ${path}`, {
      cause: error,
    });
  }
}
