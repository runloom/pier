/** 内存版 SecretsStore（测试用）：语义对齐 safeStorage 门面，无加密。 */
import type { SecretsStore } from "@main/state/secrets-store.ts";

export function makeFakeSecrets(): SecretsStore & {
  dump(): Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    dump: () => entries,
    async delete(key) {
      entries.delete(key);
    },
    async flush() {
      // 内存实现无落盘。
    },
    async get(key) {
      return entries.get(key) ?? null;
    },
    async getEncrypted(key) {
      return entries.get(key) ?? null;
    },
    async list() {
      return [...entries.keys()];
    },
    async set(key, value) {
      entries.set(key, value);
    },
    async setEncrypted(key, value) {
      entries.set(key, value);
    },
  };
}
