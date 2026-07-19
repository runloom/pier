import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileDraftsService,
  LEGACY_DRAFT_OWNER,
} from "@main/services/file-drafts-service.ts";
import { createPanelTransferFilesPort } from "@main/services/panel-transfer/file-drafts-panel-transfer-port.ts";
import { describe, expect, it } from "vitest";

const OWNER = "window-01HZZY8YSP7H2QWQZ1GBNQ1G3X";

function entryPath(userDataDir: string, owner: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(userDataDir, "file-drafts", "entries", owner, `${digest}.json`);
}

describe("createFileDraftsService", () => {
  it("durably stores independent entries with private permissions", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-file-drafts-v2-"));
    const service = createFileDraftsService({ userDataDir });

    const result = await service.set(
      OWNER,
      "pier.files.diskDraft:abc",
      7,
      '{"contents":"draft"}'
    );

    expect(result).toMatchObject({
      bytes: 20,
      generation: 7,
      key: "pier.files.diskDraft:abc",
      kind: "stored",
    });
    await expect(service.listKeys(OWNER)).resolves.toEqual([
      "pier.files.diskDraft:abc",
    ]);
    await expect(
      service.get(OWNER, "pier.files.diskDraft:abc")
    ).resolves.toMatchObject({
      generation: 7,
      key: "pier.files.diskDraft:abc",
      value: '{"contents":"draft"}',
    });

    const draftsDir = join(userDataDir, "file-drafts");
    const entriesDir = join(draftsDir, "entries");
    const ownerDir = join(entriesDir, OWNER);
    const storedEntryPath = entryPath(
      userDataDir,
      OWNER,
      "pier.files.diskDraft:abc"
    );
    expect((await stat(draftsDir)).mode % 0o1000).toBe(0o700);
    expect((await stat(entriesDir)).mode % 0o1000).toBe(0o700);
    expect((await stat(ownerDir)).mode % 0o1000).toBe(0o700);
    expect((await stat(storedEntryPath)).mode % 0o1000).toBe(0o600);
    expect((await stat(join(draftsDir, "index.json"))).mode % 0o1000).toBe(
      0o600
    );
    expect(
      (await readdir(ownerDir)).some((name) => name.endsWith(".tmp"))
    ).toBe(false);

    // set() 返回 stored 时已经提交条目，不依赖额外 flush。
    const reopened = createFileDraftsService({ userDataDir });
    await expect(
      reopened.get(OWNER, "pier.files.diskDraft:abc")
    ).resolves.toMatchObject({ generation: 7, value: '{"contents":"draft"}' });
  });

  it("rebuilds the disposable index from entry files", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-index-")
    );
    const service = createFileDraftsService({ userDataDir });
    await service.set(OWNER, "draft-a", 1, "alpha");
    await service.set(OWNER, "draft-b", 2, "beta");
    await service.flush();

    await rm(join(userDataDir, "file-drafts", "index.json"));
    const reopened = createFileDraftsService({ userDataDir });

    await expect(reopened.listKeys(OWNER)).resolves.toEqual([
      "draft-a",
      "draft-b",
    ]);
    await expect(
      access(join(userDataDir, "file-drafts", "index.json"))
    ).resolves.toBeUndefined();

    await writeFile(
      join(userDataDir, "file-drafts", "index.json"),
      "corrupt cache",
      "utf8"
    );
    const reopenedAgain = createFileDraftsService({ userDataDir });
    await expect(reopenedAgain.listKeys(OWNER)).resolves.toEqual([
      "draft-a",
      "draft-b",
    ]);
  });

  it("rejects entry and total quota overflow without evicting drafts", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-quota-")
    );
    const service = createFileDraftsService({
      maxDraftValueBytes: 6,
      maxTotalBytes: 10,
      userDataDir,
    });

    await expect(
      service.set(OWNER, "too-large", 1, "1234567")
    ).resolves.toEqual({ kind: "rejected", reason: "entry-too-large" });
    await expect(
      service.set(OWNER, "first", 1, "123456")
    ).resolves.toMatchObject({ kind: "stored" });
    await expect(service.set(OWNER, "second", 1, "12345")).resolves.toEqual({
      kind: "rejected",
      reason: "quota-exceeded",
    });

    await expect(service.listKeys(OWNER)).resolves.toEqual(["first"]);
    await expect(service.get(OWNER, "first")).resolves.toMatchObject({
      value: "123456",
    });
  });

  it("serializes generations so a late stale write cannot replace newer content", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-generation-")
    );
    const service = createFileDraftsService({ userDataDir });

    const [newer, stale] = await Promise.all([
      service.set(OWNER, "shared", 12, "newer"),
      service.set(OWNER, "shared", 11, "stale"),
    ]);

    expect(newer).toMatchObject({ generation: 12, kind: "stored" });
    expect(stale).toEqual({ kind: "rejected", reason: "stale-generation" });
    await expect(service.get(OWNER, "shared")).resolves.toMatchObject({
      generation: 12,
      value: "newer",
    });

    await expect(
      service.set(OWNER, "shared", 12, "different")
    ).resolves.toEqual({ kind: "rejected", reason: "stale-generation" });
    await expect(service.get(OWNER, "shared")).resolves.toMatchObject({
      generation: 12,
      value: "newer",
    });
  });

  it("deletes an owner-scoped entry durably", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-delete-")
    );
    const service = createFileDraftsService({ userDataDir });
    await service.set(OWNER, "same-key", 1, "owner one");
    await service.set("window-02", "same-key", 1, "owner two");

    await expect(service.delete(OWNER, "same-key")).resolves.toBe(true);
    await expect(service.delete(OWNER, "same-key")).resolves.toBe(false);

    const reopened = createFileDraftsService({ userDataDir });
    await expect(reopened.get(OWNER, "same-key")).resolves.toBeNull();
    await expect(reopened.get("window-02", "same-key")).resolves.toMatchObject({
      value: "owner two",
    });
  });

  it("migrates the old monolithic file into legacy-unassigned and keeps a backup", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-legacy-")
    );
    await writeFile(
      join(userDataDir, "file-drafts.json"),
      JSON.stringify({
        "legacy-a": '{"contents":"a"}',
        "legacy-b": '{"contents":"b"}',
      }),
      "utf8"
    );

    const service = createFileDraftsService({ userDataDir });

    await expect(service.listKeys(LEGACY_DRAFT_OWNER)).resolves.toEqual([
      "legacy-a",
      "legacy-b",
    ]);
    await expect(
      service.get(LEGACY_DRAFT_OWNER, "legacy-a")
    ).resolves.toMatchObject({ generation: 0, value: '{"contents":"a"}' });
    await expect(
      access(join(userDataDir, "file-drafts.legacy-migrated.json"))
    ).resolves.toBeUndefined();
    expect(
      (await stat(join(userDataDir, "file-drafts.legacy-migrated.json"))).mode %
        0o1000
    ).toBe(0o600);
    await expect(
      access(join(userDataDir, "file-drafts.json"))
    ).rejects.toThrow();

    // 删除可重建索引后重新启动，也不能重复导入已迁走的旧条目。
    await service.delete(LEGACY_DRAFT_OWNER, "legacy-b");
    await rm(join(userDataDir, "file-drafts", "index.json"));
    const reopened = createFileDraftsService({ userDataDir });
    await expect(reopened.listKeys(LEGACY_DRAFT_OWNER)).resolves.toEqual([
      "legacy-a",
    ]);
  });

  it("claims a legacy entry once and never overwrites a target conflict", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-claim-")
    );
    await mkdir(userDataDir, { recursive: true });
    await writeFile(
      join(userDataDir, "file-drafts.json"),
      JSON.stringify({ claimable: "legacy", conflict: "old legacy" }),
      "utf8"
    );
    const service = createFileDraftsService({ userDataDir });
    await service.listKeys(LEGACY_DRAFT_OWNER);

    await expect(
      service.claimLegacy(OWNER, "claimable")
    ).resolves.toMatchObject({
      draft: { key: "claimable", value: "legacy" },
      kind: "claimed",
    });
    await expect(
      service.claimLegacy(OWNER, "claimable")
    ).resolves.toMatchObject({
      draft: { key: "claimable", value: "legacy" },
      kind: "already-claimed",
    });
    await expect(
      service.claimLegacy("another-window", "claimable")
    ).resolves.toEqual({ kind: "not-found" });

    await service.set(OWNER, "conflict", 9, "new target");
    await expect(service.claimLegacy(OWNER, "conflict")).resolves.toMatchObject(
      {
        draft: { generation: 9, value: "new target" },
        kind: "conflict",
      }
    );
    await expect(
      service.get(LEGACY_DRAFT_OWNER, "conflict")
    ).resolves.toMatchObject({ value: "old legacy" });
  });

  it("flush waits for all queued mutations", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-flush-")
    );
    const service = createFileDraftsService({ userDataDir });
    const pending = [
      service.set(OWNER, "a", 1, "a"),
      service.set(OWNER, "b", 1, "b"),
      service.set(OWNER, "c", 1, "c"),
    ];

    await service.flush();
    await Promise.all(pending);

    const reopened = createFileDraftsService({ userDataDir });
    await expect(reopened.listKeys(OWNER)).resolves.toEqual(["a", "b", "c"]);
  });

  it("rejects a symlinked storage root instead of writing outside userData", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-file-drafts-link-"));
    const outsideDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-outside-")
    );
    await symlink(outsideDir, join(userDataDir, "file-drafts"), "dir");
    const service = createFileDraftsService({ userDataDir });

    await expect(
      service.set(OWNER, "draft", 1, "secret")
    ).resolves.toMatchObject({ kind: "failed" });
    await expect(readdir(outsideDir)).resolves.toEqual([]);
  });

  it("surfaces and preserves an unreadable draft entry instead of skipping it", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-draft-corrupt-"));
    const initial = createFileDraftsService({ userDataDir });
    await initial.set(OWNER, "healthy", 1, "recoverable");
    await initial.flush();
    const ownerDir = join(userDataDir, "file-drafts", "entries", OWNER);
    const corruptPath = join(ownerDir, `${"0".repeat(64)}.json`);
    await writeFile(corruptPath, "{not-json", "utf8");
    const service = createFileDraftsService({ userDataDir });

    await expect(service.listKeys(OWNER)).resolves.toEqual(["healthy"]);
    await expect(service.get(OWNER, "healthy")).resolves.toMatchObject({
      value: "recoverable",
    });
    await expect(service.listDiagnostics(OWNER)).resolves.toEqual([
      expect.objectContaining({
        message: expect.stringContaining("remains isolated"),
      }),
    ]);
    await expect(access(corruptPath)).rejects.toThrow();
    const quarantined = await readdir(
      join(userDataDir, "file-drafts", "quarantine", OWNER)
    );
    expect(quarantined).toHaveLength(1);
    const reopened = createFileDraftsService({ userDataDir });
    await expect(reopened.listDiagnostics(OWNER)).resolves.toHaveLength(1);
  });

  it("keeps healthy drafts available when a corrupt entry cannot be isolated", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-draft-stuck-"));
    const initial = createFileDraftsService({ userDataDir });
    await initial.set(OWNER, "healthy", 1, "recoverable");
    await initial.flush();
    const ownerDir = join(userDataDir, "file-drafts", "entries", OWNER);
    await writeFile(join(ownerDir, `${"0".repeat(64)}.json`), "{bad", "utf8");
    await writeFile(
      join(userDataDir, "file-drafts", "quarantine", OWNER),
      "blocks directory creation",
      "utf8"
    );
    const reopened = createFileDraftsService({ userDataDir });

    await expect(reopened.listKeys(OWNER)).resolves.toEqual(["healthy"]);
    await expect(reopened.listDiagnostics(OWNER)).resolves.toEqual([
      expect.objectContaining({
        message: expect.stringContaining("could not be recovered or isolated"),
      }),
    ]);
  });

  it("diagnoses a json symlink without following or silently skipping it", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-draft-symlink-"));
    const initial = createFileDraftsService({ userDataDir });
    await initial.set(OWNER, "healthy", 1, "recoverable");
    await initial.flush();
    const outsidePath = join(userDataDir, "outside.json");
    await writeFile(outsidePath, "outside", "utf8");
    const ownerDir = join(userDataDir, "file-drafts", "entries", OWNER);
    await symlink(outsidePath, join(ownerDir, `${"1".repeat(64)}.json`));
    const reopened = createFileDraftsService({ userDataDir });

    await expect(reopened.listKeys(OWNER)).resolves.toEqual(["healthy"]);
    await expect(reopened.listDiagnostics(OWNER)).resolves.toHaveLength(1);
    await expect(readFile(outsidePath, "utf8")).resolves.toBe("outside");
  });
});

describe("FileDraftsService transfer staging", () => {
  const SOURCE = "window-01HZZY8YSP7H2QWQZ1GBNQ1G3X";
  const TARGET = "window-02HZZY8YSP7H2QWQZ1GBNQ1G3Y";

  async function createService(
    options: { maxDraftValueBytes?: number; maxTotalBytes?: number } = {}
  ) {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "pier-file-drafts-transfer-")
    );
    return createFileDraftsService({ userDataDir, ...options });
  }

  it("stageTransfer copies staging to target and keeps source staging until commit", async () => {
    const service = await createService();
    const stagingKey = "transfer:t1:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 3, "staged-body");

    await service.stageTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t1",
    });

    await expect(service.get(SOURCE, stagingKey)).resolves.toMatchObject({
      generation: 3,
      value: "staged-body",
    });
    await expect(service.get(TARGET, targetKey)).resolves.toMatchObject({
      generation: 3,
      value: "staged-body",
    });

    await service.commitTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t1",
    });

    await expect(service.get(SOURCE, stagingKey)).resolves.toBeNull();
    await expect(service.get(TARGET, targetKey)).resolves.toMatchObject({
      generation: 3,
      value: "staged-body",
    });
  });

  it("rollbackTransfer removes matching target copy and staging keys", async () => {
    const service = await createService();
    const stagingKey = "transfer:t2:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 1, "rollback-me");
    await service.stageTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t2",
    });

    await service.rollbackTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t2",
    });

    await expect(service.get(SOURCE, stagingKey)).resolves.toBeNull();
    await expect(service.get(TARGET, targetKey)).resolves.toBeNull();
  });

  it("commitTransfer unlocks the target so later writes succeed", async () => {
    const service = await createService();
    const stagingKey = "transfer:t3:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 2, "commit-me");
    await service.stageTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t3",
    });

    await expect(
      service.set(TARGET, targetKey, 3, "blocked")
    ).resolves.toMatchObject({ kind: "failed" });

    await service.commitTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t3",
    });

    await expect(service.get(SOURCE, stagingKey)).resolves.toBeNull();
    await expect(
      service.set(TARGET, targetKey, 3, "after-commit")
    ).resolves.toMatchObject({ kind: "stored" });
    await expect(service.get(TARGET, targetKey)).resolves.toMatchObject({
      generation: 3,
      value: "after-commit",
    });
  });

  it("stageTransfer fails when the target key already exists", async () => {
    const service = await createService();
    const stagingKey = "transfer:t4:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 1, "source");
    await service.set(TARGET, targetKey, 1, "existing");

    await expect(
      service.stageTransfer({
        drafts: [{ sourceKey: stagingKey, targetKey }],
        sourceOwner: SOURCE,
        targetOwner: TARGET,
        transferId: "t4",
      })
    ).rejects.toThrow(/already exists/);

    await expect(service.get(SOURCE, stagingKey)).resolves.toMatchObject({
      value: "source",
    });
    await expect(service.get(TARGET, targetKey)).resolves.toMatchObject({
      value: "existing",
    });
  });

  it("stageTransfer fails when quota would be exceeded", async () => {
    const service = await createService({ maxTotalBytes: 10 });
    const stagingKey = "transfer:t5:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 1, "123456");
    await service.set(TARGET, "other", 1, "1234");

    await expect(
      service.stageTransfer({
        drafts: [{ sourceKey: stagingKey, targetKey }],
        sourceOwner: SOURCE,
        targetOwner: TARGET,
        transferId: "t5",
      })
    ).rejects.toThrow(/quota/i);

    await expect(service.get(TARGET, targetKey)).resolves.toBeNull();
    await expect(service.get(SOURCE, stagingKey)).resolves.toMatchObject({
      value: "123456",
    });
  });

  it("stageTransfer fails when the staging source draft is missing", async () => {
    const service = await createService();
    await expect(
      service.stageTransfer({
        drafts: [{ sourceKey: "missing-staging", targetKey: "doc-target-a" }],
        sourceOwner: SOURCE,
        targetOwner: TARGET,
        transferId: "t-missing",
      })
    ).rejects.toThrow(/missing/i);
  });

  it("locked target keys reject unrelated set and delete until rollback", async () => {
    const service = await createService();
    const stagingKey = "transfer:t6:doc-a";
    const targetKey = "doc-target-a";
    await service.set(SOURCE, stagingKey, 1, "locked-body");
    await service.stageTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t6",
    });

    await expect(
      service.set(TARGET, targetKey, 2, "hijack")
    ).resolves.toMatchObject({
      kind: "failed",
      message: expect.stringMatching(/locked/i),
    });
    await expect(service.delete(TARGET, targetKey)).rejects.toThrow(/locked/i);
    await expect(service.get(TARGET, targetKey)).resolves.toMatchObject({
      value: "locked-body",
    });

    await service.rollbackTransfer({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner: SOURCE,
      targetOwner: TARGET,
      transferId: "t6",
    });

    await expect(service.get(TARGET, targetKey)).resolves.toBeNull();
  });
});

describe("createPanelTransferFilesPort", () => {
  it("delegates stage/commit/rollback to FileDraftsService transfer methods", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "pier-file-drafts-port-"));
    const service = createFileDraftsService({ userDataDir });
    const port = createPanelTransferFilesPort(service);
    const sourceOwner = "window-01HZZY8YSP7H2QWQZ1GBNQ1G3X";
    const targetOwner = "window-02HZZY8YSP7H2QWQZ1GBNQ1G3Y";
    const stagingKey = "transfer:port:doc";
    const targetKey = "doc-port-target";
    await service.set(sourceOwner, stagingKey, 1, "via-port");

    await port.stageDrafts({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner,
      targetOwner,
      transferId: "port-1",
    });
    await expect(service.get(targetOwner, targetKey)).resolves.toMatchObject({
      value: "via-port",
    });

    await port.commitDrafts({
      drafts: [{ sourceKey: stagingKey, targetKey }],
      sourceOwner,
      targetOwner,
      transferId: "port-1",
    });
    await expect(service.get(sourceOwner, stagingKey)).resolves.toBeNull();
    await expect(service.get(targetOwner, targetKey)).resolves.toMatchObject({
      value: "via-port",
    });
  });
});
