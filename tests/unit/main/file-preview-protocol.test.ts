import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeFilePreviewRequest,
  FILE_PREVIEW_SCHEME,
  handleFilePreviewProtocol,
  registerFilePreviewScheme,
  resolveFilePreviewResponse,
} from "@main/files/file-preview-protocol.ts";
import { filePreviewTicketRegistry } from "@main/files/file-preview-ticket-registry.ts";
import {
  MAX_IMAGE_PREVIEW_FILE_BYTES,
  readFileWithinImagePreviewLimit,
} from "@main/files/image-preview-file.ts";
import { readFileDocument } from "@main/services/file-document-reader.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
const owner = {
  partition: "test-partition",
  recordId: "files",
  runtimeId: "test",
  webContentsId: 42,
};

function ticketUrl(locator: {
  mime?: string;
  path: string;
  revision: string;
  root: string;
}): string {
  return filePreviewTicketRegistry.issue({
    locator: { mime: locator.mime ?? "image/png", ...locator },
    owner,
  }).url;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-file-preview-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function previewUrl(path: string): Promise<string> {
  const result = await readFileDocument({ path, root });
  if (result.kind !== "image") {
    throw new Error("expected image document");
  }
  return ticketUrl({
    mime: result.mime,
    path,
    revision: result.revision,
    root,
  });
}

describe("file preview protocol", () => {
  it("serves a scoped signature-validated image with immutable response headers", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("preview"),
    ]);
    await writeFile(join(root, "image.bin"), bytes);
    const url = await previewUrl("image.bin");

    expect(url).not.toContain(root);
    const response = await resolveFilePreviewResponse(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("etag")).toMatch(/^"file-v1:[a-f0-9]+"$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
  });

  it.each([
    ["JPEG", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ["GIF", "image/gif", Buffer.from("GIF89a", "ascii")],
    [
      "WebP",
      "image/webp",
      Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.alloc(4),
        Buffer.from("WEBP", "ascii"),
      ]),
    ],
  ])("serves signature-validated %s images", async (_format, mime, bytes) => {
    await writeFile(join(root, "image.bin"), bytes);

    const response = await resolveFilePreviewResponse(
      await previewUrl("image.bin")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
  });

  it.each([
    ["path escape", "../outside.png", 404],
    ["missing file", "missing.png", 404],
  ])("rejects %s", async (_label, path, status) => {
    const url = ticketUrl({ path, revision: "file-v1:missing", root });
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status,
    });
  });

  it("rejects directories, SVG, and image-extension spoofing", async () => {
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "vector.svg"), "<svg></svg>");
    await writeFile(join(root, "spoof.png"), Buffer.from([0, 1, 2, 3]));

    for (const path of ["folder", "vector.svg", "spoof.png"]) {
      const response = await resolveFilePreviewResponse(
        ticketUrl({ path, revision: "file-v1:any", root })
      );
      expect(response.status).toBe(404);
    }
  });

  it("rejects an in-root symlink whose target escapes the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-file-preview-outside-"));
    try {
      await writeFile(
        join(outside, "image.png"),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      await symlink(join(outside, "image.png"), join(root, "linked.png"));

      const response = await resolveFilePreviewResponse(
        ticketUrl({
          path: "linked.png",
          revision: "file-v1:any",
          root,
        })
      );

      expect(response.status).toBe(404);
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("rejects a stale revision after revalidating the file bytes", async () => {
    const target = join(root, "image.png");
    await writeFile(
      target,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const url = await previewUrl("image.png");
    await writeFile(
      target,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("changed"),
      ])
    );

    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 409,
    });
  });

  it("rejects an oversized image before reading its body", async () => {
    const path = "oversized.png";
    const target = join(root, path);
    await writeFile(
      target,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    await truncate(target, MAX_IMAGE_PREVIEW_FILE_BYTES + 1);

    const response = await resolveFilePreviewResponse(
      ticketUrl({ path, revision: "file-v1:any", root })
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("aborts a bounded read when the file grew after metadata inspection", async () => {
    const target = join(root, "growing.png");
    const inspectedSize = 8;
    await writeFile(target, Buffer.alloc(inspectedSize + 1, 1));

    await expect(
      readFileWithinImagePreviewLimit(target, inspectedSize)
    ).resolves.toBeNull();
  });

  it("authorizes only the ticket-owning partition and webContents", () => {
    const url = ticketUrl({
      path: "image.png",
      revision: "file-v1:test",
      root,
    });

    expect(
      authorizeFilePreviewRequest(
        { url, webContentsId: owner.webContentsId },
        owner.partition
      )
    ).toBe(true);
    expect(
      authorizeFilePreviewRequest(
        { url, webContentsId: owner.webContentsId + 1 },
        owner.partition
      )
    ).toBe(false);
    expect(
      authorizeFilePreviewRequest(
        { url, webContentsId: owner.webContentsId },
        "other-partition"
      )
    ).toBe(false);
  });

  it("registers only the secure standard fetch-enabled preview scheme", () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerFilePreviewScheme({
      handle: vi.fn(),
      registerSchemesAsPrivileged,
    });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        privileges: {
          secure: true,
          standard: true,
          supportFetchAPI: true,
        },
        scheme: FILE_PREVIEW_SCHEME,
      },
    ]);
  });

  it("registers a handler that delegates requests to the pure resolver", async () => {
    const handle = vi.fn();
    handleFilePreviewProtocol({
      handle,
      registerSchemesAsPrivileged: vi.fn(),
    });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(
      FILE_PREVIEW_SCHEME,
      expect.any(Function)
    );

    const handler = handle.mock.calls[0]?.[1];
    const response = await handler?.(
      new Request(`${FILE_PREVIEW_SCHEME}://wrong-host`)
    );
    expect(response).toMatchObject({ status: 404 });
  });

  it("serves absolute-path locators used by host media preview", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("absolute"),
    ]);
    const absolutePath = join(root, "absolute.png");
    await writeFile(absolutePath, bytes);
    const { resolveAbsoluteImagePreview } = await import(
      "@main/files/absolute-image-preview.ts"
    );
    const resolved = await resolveAbsoluteImagePreview(absolutePath);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    const url = filePreviewTicketRegistry.issue({
      locator: resolved.locator,
      owner,
    }).url;
    const response = await resolveFilePreviewResponse(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toMatch(/^"abs-v1:[a-f0-9]+"$/);
  });
});
