import { join } from "node:path";
import { app, safeStorage } from "electron";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

// --- disk schema ---

interface SecretsFile {
  entries: Record<string, SecretEntry>;
  version: 1;
}

interface SecretEntry {
  /** keyVersion==1: base64(safeStorage.encryptString(plaintext)) */
  encrypted?: string;
  /** 1 = safeStorage encrypted (base64 wrapper), 0 = plaintext fallback */
  keyVersion: 0 | 1;
  /** keyVersion==0: raw plaintext (safeStorage unavailable) */
  plaintext?: string;
}

// --- public interface ---

export interface SecretsStore {
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
  get(key: string): Promise<string | null>;
  getEncrypted(key: string): Promise<string | null>;
  list(): Promise<string[]>;
  set(key: string, value: string): Promise<void>;
  setEncrypted(key: string, value: string): Promise<void>;
}

// --- safeStorage helpers (file-scope, not exported) ---

function isAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encrypt(plaintext: string): string | null {
  try {
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

function decrypt(ciphertext: string): string | null {
  try {
    const buffer = Buffer.from(ciphertext, "base64");
    const plaintext = safeStorage.decryptString(buffer);
    return plaintext;
  } catch (err) {
    console.warn(
      "[secrets] decrypt failed (keychain may have changed):",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

// --- factory ---

const DEFAULTS: SecretsFile = {
  version: 1,
  entries: {},
};

let store: DebouncedJsonStore<SecretsFile> | undefined;

function getStore(): DebouncedJsonStore<SecretsFile> {
  if (!store) {
    store = debouncedJsonStore<SecretsFile>({
      filePath: join(app.getPath("userData"), "secrets.json"),
      defaults: DEFAULTS,
      debounceMs: 500,
    });
  }
  return store;
}

export function createSecretsStore(): SecretsStore {
  // Lazy-init: store is constructed here but init() (disk read) is
  // deferred until the first get/set/delete/flush call touches it.
  // safeStorage is never called during construction.
  const ready: Promise<DebouncedJsonStore<SecretsFile>> = (async () => {
    const s = getStore();
    await s.init();
    return s;
  })();

  return {
    async get(key) {
      const s = await ready;
      const entry = s.get().entries[key];
      if (!entry) {
        return null;
      }

      if (entry.keyVersion === 1 && entry.encrypted) {
        const plaintext = decrypt(entry.encrypted);
        if (plaintext !== null) {
          return plaintext;
        }
        // Decrypt failed — fall back to plaintext field if present
        if (entry.plaintext !== undefined) {
          return entry.plaintext;
        }
        return null;
      }

      if (entry.keyVersion === 0 && entry.plaintext !== undefined) {
        return entry.plaintext;
      }

      return null;
    },

    async getEncrypted(key) {
      const s = await ready;
      const entry = s.get().entries[key];
      if (!entry) return null;
      if (!(entry.keyVersion === 1 && entry.encrypted)) {
        throw new Error("plugin secret is not encrypted");
      }
      const plaintext = decrypt(entry.encrypted);
      if (plaintext === null) {
        throw new Error("plugin secret decryption failed");
      }
      return plaintext;
    },

    async set(key, value) {
      const s = await ready;
      let entry: SecretEntry;

      if (isAvailable()) {
        const encrypted = encrypt(value);
        if (encrypted === null) {
          entry = { keyVersion: 0, plaintext: value };
        } else {
          entry = { keyVersion: 1, encrypted };
        }
      } else {
        entry = { keyVersion: 0, plaintext: value };
      }

      s.mutate((state) => ({
        ...state,
        entries: { ...state.entries, [key]: entry },
      }));
    },

    async setEncrypted(key, value) {
      const s = await ready;
      if (!isAvailable()) {
        throw new Error("secure storage is unavailable");
      }
      const encrypted = encrypt(value);
      if (encrypted === null) {
        throw new Error("secure storage encryption failed");
      }
      s.mutate((state) => ({
        ...state,
        entries: {
          ...state.entries,
          [key]: { encrypted, keyVersion: 1 },
        },
      }));
    },

    async delete(key) {
      const s = await ready;
      s.mutate((state) => {
        const entries = { ...state.entries };
        delete entries[key];
        return { ...state, entries };
      });
    },

    async list() {
      const s = await ready;
      return Object.keys(s.get().entries);
    },

    async flush() {
      const s = await ready;
      await s.flush();
    },
  };
}
