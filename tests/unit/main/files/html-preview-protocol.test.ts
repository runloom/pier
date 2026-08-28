import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeHtmlPreviewRequest,
  HTML_PREVIEW_SCHEME,
  handleHtmlPreviewProtocol,
  registerHtmlPreviewScheme,
  resolveHtmlPreviewResponse,
} from "@main/files/html-preview-protocol.ts";
import {
  createHtmlPreviewTicketRegistry,
  type HtmlPreviewTicketRegistry,
} from "@main/files/html-preview-ticket-registry.ts";
import { buildHtmlPreviewUrl } from "@shared/contracts/file/html-preview-url.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let rootRealpath: string;
let registry: HtmlPreviewTicketRegistry;
const owner = { partition: "test-partition", webContentsId: 42 };

function previewUrl(relPath: string, rootOverride?: string): string {
  const issued = registry.issue({
    owner,
    rootRealpath: rootOverride ?? rootRealpath,
  });
  return buildHtmlPreviewUrl(issued.ticket, relPath);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-html-preview-"));
  rootRealpath = await realpath(root);
  let sequence = 0;
  registry = createHtmlPreviewTicketRegistry({
    now: Date.now,
    randomToken: () => `${++sequence}`.padStart(32, "0"),
  });
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("html preview protocol", () => {
  it("serves the html document with permissive preview headers", async () => {
    const bytes = Buffer.from(
      "<!doctype html><html><body>preview</body></html>"
    );
    await writeFile(join(root, "demo.html"), bytes);
    const url = previewUrl("demo.html");

    expect(url.startsWith(`${HTML_PREVIEW_SCHEME}://preview/`)).toBe(true);
    expect(url).not.toContain(root);

    const response = await resolveHtmlPreviewResponse(url, registry);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.text()).resolves.toBe(bytes.toString("utf8"));
  });

  it.each([
    ["style.css", "text/css; charset=utf-8"],
    ["app.js", "text/javascript; charset=utf-8"],
    ["module.mjs", "text/javascript; charset=utf-8"],
    ["data.json", "application/json; charset=utf-8"],
    ["pic.png", "image/png"],
    ["vector.svg", "image/svg+xml"],
    ["font.woff2", "font/woff2"],
    ["unknown.bin", "application/octet-stream"],
  ])("serves sibling asset %s with its content type", async (name, mime) => {
    await writeFile(join(root, name), Buffer.from([1, 2, 3]));

    const response = await resolveHtmlPreviewResponse(
      previewUrl(name),
      registry
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mime);
  });

  it.each([
    ["path escape", "../outside.html"],
    ["missing file", "missing.html"],
  ])("rejects %s with 404", async (_label, relPath) => {
    const response = await resolveHtmlPreviewResponse(
      previewUrl(relPath),
      registry
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects an in-root symlink whose target escapes the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-html-preview-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));

      const response = await resolveHtmlPreviewResponse(
        previewUrl("linked.txt"),
        registry
      );

      expect(response.status).toBe(404);
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("rejects directories and unknown tickets", async () => {
    await mkdir(join(root, "folder"));

    const directory = await resolveHtmlPreviewResponse(
      previewUrl("folder"),
      registry
    );
    expect(directory.status).toBe(404);

    const unknown = await resolveHtmlPreviewResponse(
      buildHtmlPreviewUrl("0".repeat(32), "demo.html"),
      registry
    );
    expect(unknown.status).toBe(404);
  });

  it("authorizes only the ticket-owning partition and webContents", () => {
    const url = previewUrl("demo.html");

    expect(
      authorizeHtmlPreviewRequest(
        { url, webContentsId: owner.webContentsId },
        owner.partition,
        registry
      )
    ).toBe(true);
    expect(
      authorizeHtmlPreviewRequest(
        { url, webContentsId: owner.webContentsId + 1 },
        owner.partition,
        registry
      )
    ).toBe(false);
    expect(
      authorizeHtmlPreviewRequest(
        { url, webContentsId: owner.webContentsId },
        "other-partition",
        registry
      )
    ).toBe(false);
  });

  it("registers a cors-enabled secure standard fetch-enabled scheme", () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerHtmlPreviewScheme({
      handle: vi.fn(),
      registerSchemesAsPrivileged,
    });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        privileges: {
          corsEnabled: true,
          secure: true,
          standard: true,
          supportFetchAPI: true,
        },
        scheme: HTML_PREVIEW_SCHEME,
      },
    ]);
  });

  it("registers a handler that delegates requests to the pure resolver", async () => {
    const handle = vi.fn();
    handleHtmlPreviewProtocol({
      handle,
      registerSchemesAsPrivileged: vi.fn(),
    });
    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(
      HTML_PREVIEW_SCHEME,
      expect.any(Function)
    );

    const handler = handle.mock.calls[0]?.[1];
    const response = await handler?.(
      new Request(`${HTML_PREVIEW_SCHEME}://wrong-host`)
    );
    expect(response).toMatchObject({ status: 404 });
  });
});
