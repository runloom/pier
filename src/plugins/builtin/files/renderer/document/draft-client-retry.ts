import type {
  FilesDraftBackend,
  FilesDraftProtectionState,
} from "./draft-client-types.ts";

/** commitFilesDraftSuspend 内对失败键的重新发布次数上限。 */
export const MAX_DRAFT_COMMIT_RETRIES = 2;

export const DELETED_DRAFT_VALUE = "__pier_files_deleted_draft_v1__";

/**
 * 重新发布 protection 为 failed 的键：tombstone 走删除重试，其余以新
 * generation 重新 set。返回是否有键被重发（供调用方区分可重试与硬失败）。
 */
export function republishFailedDraftKeys(input: {
  backend: FilesDraftBackend | null;
  generations: Map<string, number>;
  hydratedDrafts: ReadonlyMap<string, string>;
  protection: ReadonlyMap<string, FilesDraftProtectionState>;
  retryDelete: (backend: FilesDraftBackend, key: string) => void;
  startWrite: (
    backend: FilesDraftBackend,
    key: string,
    generation: number,
    value: string
  ) => void;
}): boolean {
  if (!input.backend) {
    return false;
  }
  let republished = false;
  for (const [key, state] of [...input.protection.entries()]) {
    if (state.status !== "failed") {
      continue;
    }
    const value = input.hydratedDrafts.get(key);
    if (value === DELETED_DRAFT_VALUE) {
      input.retryDelete(input.backend, key);
    } else if (value !== undefined) {
      const generation = (input.generations.get(key) ?? 0) + 1;
      input.generations.set(key, generation);
      input.startWrite(input.backend, key, generation, value);
    }
    republished = true;
  }
  return republished;
}

/**
 * 带重试的 flush：失败且 retry() 可重发时重新发布后重试，次数封顶；
 * 无键可重发或达到上限时抛出原始错误。
 */
export async function flushWithDraftRetries(
  flush: (signal?: AbortSignal) => Promise<void>,
  retry: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await flush(signal);
      return;
    } catch (error) {
      if (attempt >= MAX_DRAFT_COMMIT_RETRIES || !retry()) {
        throw error;
      }
    }
  }
}
