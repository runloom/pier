import type { FilesDraftBackend } from "@plugins/builtin/files/renderer/files-document-drafts.ts";
import {
  commitFilesDraftSuspend,
  filesDraftProtectionState,
  flushFilesDraftWrites,
  prepareFilesDraftSuspend,
  resetFilesDraftBackendForTests,
  resumeFilesDraftWrites,
} from "@plugins/builtin/files/renderer/files-document-drafts.ts";
import {
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/files-document-store.ts";
import type { FileDraftWriteResult } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function draftBackend(set: FilesDraftBackend["set"]): FilesDraftBackend {
  return {
    claimLegacy: async () => ({ kind: "not-found" }),
    delete: async () => false,
    get: async () => null,
    listKeys: async () => [],
    set,
  };
}

function stored(
  key: string,
  generation: number,
  value: string
): FileDraftWriteResult {
  return {
    bytes: value.length,
    generation,
    key,
    kind: "stored",
    updatedAt: generation,
  };
}

afterEach(() => {
  clearFilesDocumentStore({ persisted: false });
  resetFilesDraftBackendForTests();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

describe("Files draft lifecycle barrier", () => {
  it("waits for the current generation and resumes deferred writes after abort", async () => {
    const first = deferred<FileDraftWriteResult>();
    const calls: Array<{ generation: number; key: string; value: string }> = [];
    const set = vi.fn(
      async (key: string, generation: number, value: string) => {
        calls.push({ generation, key, value });
        return calls.length === 1
          ? await first.promise
          : stored(key, generation, value);
      }
    );
    await configureFilesDraftBackend(draftBackend(set));
    const document = createUntitledMarkdownDocument({ contents: "first" });
    const key = `pier.files.untitledDraft:${document.id}`;
    const controller = new AbortController();

    const preparation = prepareFilesDraftSuspend(controller.signal);
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    first.resolve(stored(key, calls[0]!.generation, calls[0]!.value));
    await preparation;
    expect(filesDraftProtectionState(key).status).toBe("protected");

    updateDocumentContents(document.id, "changed during a later veto");
    expect(calls).toHaveLength(1);
    expect(filesDraftProtectionState(key).status).toBe("failed");

    resumeFilesDraftWrites();
    await flushFilesDraftWrites();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.value).toContain("changed during a later veto");
    expect(filesDraftProtectionState(key).status).toBe("protected");
  });

  it("rejects preparation when the latest generation is not durably stored", async () => {
    const set = vi.fn(
      async (): Promise<FileDraftWriteResult> => ({
        kind: "rejected",
        reason: "quota-exceeded",
      })
    );
    await configureFilesDraftBackend(draftBackend(set));
    createUntitledMarkdownDocument({ contents: "large draft" });

    await expect(
      prepareFilesDraftSuspend(new AbortController().signal)
    ).rejects.toThrow("Unable to auto-save draft");
  });

  it("honors cancellation while a backend write is still pending", async () => {
    const pending = deferred<FileDraftWriteResult>();
    await configureFilesDraftBackend(
      draftBackend(async () => await pending.promise)
    );
    createUntitledMarkdownDocument({ contents: "pending draft" });
    const controller = new AbortController();
    const preparation = prepareFilesDraftSuspend(controller.signal);

    controller.abort();

    await expect(preparation).rejects.toMatchObject({ name: "AbortError" });
  });

  it("still writes to main when emergency local storage is unavailable", async () => {
    const set = vi.fn(async (key: string, generation: number, value: string) =>
      stored(key, generation, value)
    );
    await configureFilesDraftBackend(draftBackend(set));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("storage blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    const document = createUntitledMarkdownDocument({ contents: "protected" });
    await flushFilesDraftWrites();

    expect(set).toHaveBeenCalledOnce();
    expect(
      filesDraftProtectionState(`pier.files.untitledDraft:${document.id}`)
        .status
    ).toBe("protected");
  });

  it("durably flushes edits made between prepare and commit", async () => {
    const set = vi.fn(async (key: string, generation: number, value: string) =>
      stored(key, generation, value)
    );
    await configureFilesDraftBackend(draftBackend(set));
    const document = createUntitledMarkdownDocument({ contents: "before" });
    await flushFilesDraftWrites();

    await prepareFilesDraftSuspend(new AbortController().signal);
    updateDocumentContents(document.id, "during transition");
    await commitFilesDraftSuspend();

    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.at(-1)?.[2]).toContain("during transition");
  });
});
