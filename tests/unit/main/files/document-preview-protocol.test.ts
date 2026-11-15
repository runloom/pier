import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFilePreviewResponse } from "@main/files/preview-protocol.ts";
import { filePreviewTicketRegistry } from "@main/files/preview-ticket-registry.ts";
import { readFileDocument } from "@main/services/files/document-reader.ts";
import {
  FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT,
  MAX_FILE_PREVIEW_BYTES,
} from "@shared/contracts/file/document.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
const owner = {
  partition: "test-partition",
  recordId: "files",
  runtimeId: "test",
  webContentsId: 42,
};

function ticketUrl(locator: {
  mime: string;
  path: string;
  revision: string;
  root: string;
}): string {
  return filePreviewTicketRegistry.issue({ locator, owner }).url;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-document-preview-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function documentUrl(
  path: string
): Promise<{ mime: string; url: string }> {
  const result = await readFileDocument({ path, root });
  if (result.kind !== "document") {
    throw new Error("expected document");
  }
  return {
    mime: result.mime,
    url: ticketUrl({
      mime: result.mime,
      path,
      revision: result.revision,
      root,
    }),
  };
}

describe("document preview protocol", () => {
  it("serves docx bytes when the ticket MIME matches classification", async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(64),
    ]);
    await writeFile(join(root, "a.docx"), bytes);
    const { url } = await documentUrl("a.docx");

    const response = await resolveFilePreviewResponse(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT.docx
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
  });

  it("serves xlsx bytes", async () => {
    await writeFile(
      join(root, "a.xlsx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    );
    const { url } = await documentUrl("a.xlsx");
    const response = await resolveFilePreviewResponse(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT.xlsx
    );
  });

  it("returns 404 when a document ticket resolves to another format", async () => {
    await writeFile(join(root, "a.pdf"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const url = ticketUrl({
      mime: "application/pdf",
      path: "a.pdf",
      revision: "file-v1:stale",
      root,
    });
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 404,
    });
  });

  it("returns 404 for a CFB docx ticket even when the MIME matches the extension", async () => {
    await writeFile(
      join(root, "secret.docx"),
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );
    const url = ticketUrl({
      mime: FILE_PREVIEW_MIME_BY_DOCUMENT_FORMAT.docx,
      path: "secret.docx",
      revision: "file-v1:any",
      root,
    });
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 404,
    });
  });

  it("returns 409 on a stale revision", async () => {
    const original = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    await writeFile(join(root, "a.docx"), original);
    const { url } = await documentUrl("a.docx");
    await writeFile(
      join(root, "a.docx"),
      Buffer.concat([original, Buffer.from("changed")])
    );
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 409,
    });
  });

  it("returns 413 when the file grew past the preview limit", async () => {
    await writeFile(
      join(root, "a.docx"),
      Buffer.from([0x50, 0x4b, 0x03, 0x04])
    );
    const { url } = await documentUrl("a.docx");
    await truncate(join(root, "a.docx"), MAX_FILE_PREVIEW_BYTES + 1);
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 413,
    });
  });

  it("returns 413 for a document above 64 MiB", async () => {
    await writeFile(join(root, "a.pdf"), "%PDF-1.7\n");
    await truncate(join(root, "a.pdf"), MAX_FILE_PREVIEW_BYTES + 1);
    const url = ticketUrl({
      mime: "application/pdf",
      path: "a.pdf",
      revision: "file-v1:any",
      root,
    });
    await expect(resolveFilePreviewResponse(url)).resolves.toMatchObject({
      status: 413,
    });
  });
});
