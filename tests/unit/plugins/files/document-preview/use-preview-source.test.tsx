import type { DocumentPreviewContext } from "@plugins/builtin/files/renderer/preview/document/types.ts";
import { usePreviewSource } from "@plugins/builtin/files/renderer/preview/document/use-preview-source.ts";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function previewContext(
  issue: ReturnType<typeof vi.fn>
): DocumentPreviewContext {
  return {
    filePreviews: {
      issue,
      release: vi.fn(async () => true),
    },
  } as unknown as DocumentPreviewContext;
}

function args(
  context: DocumentPreviewContext,
  overrides: Partial<{
    deletedOnDisk: boolean;
    path: string;
    revision: string;
  }> = {}
) {
  return {
    context,
    mime: "application/pdf",
    path: "retained.pdf",
    revision: "r1",
    root: "/preview-source-cache",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePreviewSource", () => {
  it("reuses retained bytes so a deleted document keeps its preview after remount", async () => {
    const issue = vi.fn(async () => ({
      expiresAt: 0,
      issued: true as const,
      ticket: "t1",
      url: "pier-file-preview://file/t1",
    }));
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/pdf" },
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const context = previewContext(issue);

    const first = renderHook(() =>
      usePreviewSource(args(context, { path: "deleted-after-read.pdf" }))
    );
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    first.unmount();

    const second = renderHook(() =>
      usePreviewSource(
        args(context, {
          deletedOnDisk: true,
          path: "deleted-after-read.pdf",
        })
      )
    );
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(issue).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports a deleted document without issuing a ticket for a missing path", async () => {
    const issue = vi.fn();
    const context = previewContext(issue);

    const { result } = renderHook(() =>
      usePreviewSource(
        args(context, { deletedOnDisk: true, path: "never-fetched.pdf" })
      )
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ error: "deleted" });
    expect(issue).not.toHaveBeenCalled();
  });
});
