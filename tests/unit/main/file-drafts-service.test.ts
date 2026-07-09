import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDraftsService } from "@main/services/file-drafts-service.ts";
import { describe, expect, it } from "vitest";

describe("createFileDraftsService", () => {
  it("persists drafts to userData json and survives a new service instance", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-file-drafts-"));
    const service = createFileDraftsService({ userDataDir });

    await service.set("pier.files.diskDraft:abc", '{"contents":"draft"}');
    await service.set("pier.files.untitledDraft:1", '{"contents":"note"}');
    await service.delete("pier.files.untitledDraft:1");
    await service.flush();

    const raw = await readFile(join(userDataDir, "file-drafts.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({
      "pier.files.diskDraft:abc": '{"contents":"draft"}',
    });

    const reopened = createFileDraftsService({ userDataDir });
    await expect(reopened.list()).resolves.toEqual({
      "pier.files.diskDraft:abc": '{"contents":"draft"}',
    });
  });

  it("rejects oversized draft payloads instead of bloating the store", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-file-drafts-big-"));
    const service = createFileDraftsService({ userDataDir });

    await service.set("huge", "x".repeat(3 * 1024 * 1024));
    await service.flush();

    await expect(service.list()).resolves.toEqual({});
  });
});
