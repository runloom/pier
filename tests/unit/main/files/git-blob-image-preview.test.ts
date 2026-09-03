import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFilePreviewResponse } from "@main/files/preview-protocol.ts";
import { filePreviewTicketRegistry } from "@main/files/preview-ticket-registry.ts";
import { execGit } from "@main/services/git/exec.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const owner = {
  partition: "test-partition",
  recordId: "git-review",
  runtimeId: "test",
  webContentsId: 7,
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-git-blob-preview-"));
  await execGit(["init"], { cwd: root });
  await writeFile(join(root, "icon.png"), PNG_1X1);
  await execGit(["add", "--", "icon.png"], { cwd: root });
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("git blob image preview protocol", () => {
  it("serves a signature-validated blob and rejects a missing oid", async () => {
    const oid = (
      await execGit(["rev-parse", ":icon.png"], { cwd: root })
    ).trim();
    const url = filePreviewTicketRegistry.issue({
      locator: {
        gitRoot: root,
        mime: "image/png",
        oid,
        revision: oid,
      },
      owner,
    }).url;
    const response = await resolveFilePreviewResponse(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toBe(`"${oid}"`);

    const missing = filePreviewTicketRegistry.issue({
      locator: {
        gitRoot: root,
        mime: "image/png",
        oid: "a".repeat(40),
        revision: "a".repeat(40),
      },
      owner,
    }).url;
    await expect(resolveFilePreviewResponse(missing)).resolves.toMatchObject({
      status: 404,
    });
  });

  it("serves a signature-validated SVG blob", async () => {
    await writeFile(
      join(root, "mark.svg"),
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'></svg>"
    );
    await execGit(["add", "--", "mark.svg"], { cwd: root });
    const oid = (
      await execGit(["rev-parse", ":mark.svg"], { cwd: root })
    ).trim();
    const url = filePreviewTicketRegistry.issue({
      locator: {
        gitRoot: root,
        mime: "image/svg+xml",
        oid,
        revision: oid,
      },
      owner,
    }).url;
    const response = await resolveFilePreviewResponse(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
  });
});
