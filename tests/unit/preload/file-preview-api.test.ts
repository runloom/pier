import {
  createFilePreviewApi,
  type FilePreviewApiDependencies,
} from "@preload/file-preview-api.ts";
import { describe, expect, it, vi } from "vitest";

const leaseId = "runtime-lease-000000000";
const request = {
  leaseId,
  locator: {
    mime: "image/png",
    path: "image.png",
    revision: "file-v1:a",
    root: "/repo",
  },
};

function dependencies(overrides: Partial<FilePreviewApiDependencies> = {}) {
  return {
    invokeAcquire: vi.fn(async () => ({
      acquired: true,
      leaseId,
      runtimeId: "runtime-id-00000000000",
    })),
    invokeIssue: vi.fn(async () => ({
      expiresAt: 100,
      issued: true,
      ticket: "preview-ticket-00000000",
      url: "pier-file-preview://file/preview-ticket-00000000",
    })),
    invokeRelease: vi.fn(async () => true),
    invokeRevoke: vi.fn(async () => true),
    ...overrides,
  };
}

describe("file preview preload API", () => {
  it("validates runtime leases and issued ticket responses", async () => {
    const deps = dependencies();
    const api = createFilePreviewApi(deps);

    await expect(api.acquire("pier.files")).resolves.toMatchObject({
      acquired: true,
    });
    await expect(api.issue(request)).resolves.toMatchObject({ issued: true });
    expect(deps.invokeIssue).toHaveBeenCalledWith(request);
  });

  it("fails closed on malformed IPC responses and operation errors", async () => {
    const api = createFilePreviewApi(
      dependencies({
        invokeAcquire: vi.fn(async () => ({
          acquired: true,
          leaseId: "short",
        })),
        invokeIssue: vi.fn(async () => ({
          issued: true,
          url: "file:///repo/image.png",
        })),
        invokeRelease: vi.fn(async () => {
          throw new Error("closed");
        }),
        invokeRevoke: vi.fn(async () => {
          throw new Error("closed");
        }),
      })
    );

    await expect(api.acquire("pier.files")).resolves.toEqual({
      acquired: false,
      reason: "unavailable",
    });
    await expect(api.issue(request)).resolves.toEqual({
      issued: false,
      reason: "unavailable",
    });
    await expect(
      api.release({ leaseId, ticket: "preview-ticket-00000000" })
    ).resolves.toBe(false);
    await expect(api.revoke(leaseId)).resolves.toBe(false);
  });
});
