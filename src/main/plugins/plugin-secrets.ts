import type { SecretsStore } from "../state/secrets-store.ts";

export interface PluginSecretsFacade {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

function assertSecretKey(key: string): void {
  if (key.length === 0 || key.includes("\0")) {
    throw new Error("plugin secret key must be a non-empty safe string");
  }
}

export function createPluginSecretsFacade(
  store: SecretsStore,
  pluginId: string,
  access: { read: boolean; write: boolean }
): PluginSecretsFacade {
  const scopedKey = (key: string): string => {
    assertSecretKey(key);
    return `plugin:${pluginId.length}:${pluginId}:${key}`;
  };
  return {
    async delete(key) {
      if (!access.write)
        throw new Error("plugin secret write capability not granted");
      await store.delete(scopedKey(key));
      await store.flush();
    },
    get(key) {
      if (!access.read)
        throw new Error("plugin secret read capability not granted");
      return store.getEncrypted(scopedKey(key));
    },
    async set(key, value) {
      if (!access.write)
        throw new Error("plugin secret write capability not granted");
      await store.setEncrypted(scopedKey(key), value);
      await store.flush();
    },
  };
}
