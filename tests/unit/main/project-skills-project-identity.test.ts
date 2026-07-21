import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canRekeyProjectIdentity,
  resolveStableProjectIdentity,
  type StableProjectIdentity,
} from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-project-skills-id-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("project-skills StableProjectIdentity", () => {
  it("resolves realPath, volumeId, and directoryIdentity for a directory", async () => {
    const project = join(root, "proj");
    await mkdir(project);

    const identity = await resolveStableProjectIdentity(project);

    expect(identity.realPath.length).toBeGreaterThan(0);
    expect(identity.volumeId.length).toBeGreaterThan(0);
    expect(identity.directoryIdentity.length).toBeGreaterThan(0);
    expect(identity.directoryIdentity).toMatch(/^\d+:\d+/);
  });

  it("keeps directoryIdentity stable across same-volume rename", async () => {
    const original = join(root, "alpha");
    const moved = join(root, "beta");
    await mkdir(original);

    const before = await resolveStableProjectIdentity(original);
    await rename(original, moved);
    const after = await resolveStableProjectIdentity(moved);

    expect(after.directoryIdentity).toBe(before.directoryIdentity);
    expect(after.volumeId).toBe(before.volumeId);
    expect(after.realPath).not.toBe(before.realPath);
  });
});

describe("project-skills identity rekey policy", () => {
  it("allows same-volume rekey only when old path is gone and identity uniquely matches", () => {
    const previous: StableProjectIdentity = {
      realPath: "/Users/me/old-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };
    const next: StableProjectIdentity = {
      realPath: "/Users/me/new-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };

    expect(
      canRekeyProjectIdentity({
        previous,
        next,
        oldPathExists: false,
        matchingLedgerCount: 1,
      })
    ).toEqual({ allowed: true });
  });

  it("rejects rekey when old path still exists", () => {
    const previous: StableProjectIdentity = {
      realPath: "/Users/me/old-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };
    const next: StableProjectIdentity = {
      realPath: "/Users/me/new-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };

    expect(
      canRekeyProjectIdentity({
        previous,
        next,
        oldPathExists: true,
        matchingLedgerCount: 1,
      })
    ).toEqual({ allowed: false, reason: "old-path-still-present" });
  });

  it("rejects rekey when identity match is not unique", () => {
    const previous: StableProjectIdentity = {
      realPath: "/Users/me/old-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };
    const next: StableProjectIdentity = {
      realPath: "/Users/me/new-name",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };

    expect(
      canRekeyProjectIdentity({
        previous,
        next,
        oldPathExists: false,
        matchingLedgerCount: 2,
      })
    ).toEqual({ allowed: false, reason: "identity-not-unique" });
  });

  it("treats cross-volume path as new project (no inherit)", () => {
    const previous: StableProjectIdentity = {
      realPath: "/Volumes/A/proj",
      volumeId: "vol-a",
      directoryIdentity: "10:1",
    };
    const next: StableProjectIdentity = {
      realPath: "/Volumes/B/proj",
      volumeId: "vol-b",
      directoryIdentity: "20:2",
    };

    expect(
      canRekeyProjectIdentity({
        previous,
        next,
        oldPathExists: false,
        matchingLedgerCount: 0,
      })
    ).toEqual({ allowed: false, reason: "new-project" });
  });

  it("treats same-path rebuild with new directory identity as new project", () => {
    const previous: StableProjectIdentity = {
      realPath: "/Users/me/proj",
      volumeId: "vol-1",
      directoryIdentity: "1:100",
    };
    const next: StableProjectIdentity = {
      realPath: "/Users/me/proj",
      volumeId: "vol-1",
      directoryIdentity: "1:999",
    };

    expect(
      canRekeyProjectIdentity({
        previous,
        next,
        oldPathExists: false,
        matchingLedgerCount: 0,
      })
    ).toEqual({ allowed: false, reason: "new-project" });
  });

  it("does not inherit when clone/rebuild lands on a reused path with different identity", async () => {
    const pathA = join(root, "clone-path");
    await mkdir(pathA);
    const first = await resolveStableProjectIdentity(pathA);
    await rm(pathA, { recursive: true, force: true });
    await mkdir(pathA);
    const second = await resolveStableProjectIdentity(pathA);

    // New inode → new project; rekey forbidden.
    expect(second.directoryIdentity).not.toBe(first.directoryIdentity);
    expect(
      canRekeyProjectIdentity({
        previous: first,
        next: second,
        oldPathExists: false,
        matchingLedgerCount: 0,
      })
    ).toEqual({ allowed: false, reason: "new-project" });
  });
});

describe("project-skills paths", () => {
  it("derives stable root keys and ledger paths under userData", () => {
    const userData = "/tmp/pier-user-data";
    const paths = createProjectSkillsPaths(userData);
    const identity: StableProjectIdentity = {
      realPath: "/Users/me/proj",
      volumeId: "vol-1",
      directoryIdentity: "1:42:100",
    };

    const key = paths.rootKeyFor(identity);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(paths.rootKeyFor(identity)).toBe(key);

    // Different identity → different key (no inherit across projects).
    const otherKey = paths.rootKeyFor({
      ...identity,
      directoryIdentity: "1:43:100",
    });
    expect(otherKey).not.toBe(key);

    const projectDir = paths.projectDir(key);
    expect(projectDir).toBe(join(userData, "project-skills", key));
    expect(paths.ownershipPath(key)).toBe(join(projectDir, "ownership.json"));
    expect(paths.operationsDir(key)).toBe(join(projectDir, "operations"));
    expect(paths.stagingDir(key)).toBe(join(projectDir, "staging"));
  });

  it("root key ignores realPath so same-volume rename can rekey in place", () => {
    const paths = createProjectSkillsPaths("/tmp/ud");
    const a: StableProjectIdentity = {
      realPath: "/old",
      volumeId: "vol-1",
      directoryIdentity: "1:1",
    };
    const b: StableProjectIdentity = {
      realPath: "/new",
      volumeId: "vol-1",
      directoryIdentity: "1:1",
    };
    expect(paths.rootKeyFor(a)).toBe(paths.rootKeyFor(b));
  });
});
