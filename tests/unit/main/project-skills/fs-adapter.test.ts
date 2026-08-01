import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createProjectSkillsFileSystemAdapter } from "@main/services/project-skills/fs-adapter.ts";
import {
  assertProjectRelativeAncestorsReal,
  ensureProjectRelativeDir,
} from "@main/services/project-skills/path-containment.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-project-skills-fs-"));
  outside = await mkdtemp(join(tmpdir(), "pier-project-skills-outside-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
  await rm(outside, { force: true, recursive: true });
});

describe("project skills filesystem adapter", () => {
  it("returns conflict from publishSymlinkNoReplace without changing existing identity", async () => {
    const linkPath = join(root, ".agents", "skills", "review-guide");
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink("../../.pier/skills/library/review-guide", linkPath);
    const before = await lstat(linkPath);
    const adapter = createProjectSkillsFileSystemAdapter();
    const beforeIdentity = await adapter.lstatIdentity(linkPath);

    const result = await adapter.publishSymlinkNoReplace({
      linkPath,
      relativeTarget: "../../.pier/skills/library/other",
    });

    expect(result).toEqual({
      reason: "target-exists",
      status: "conflict",
    });
    const after = await lstat(linkPath);
    expect(after.ino).toBe(before.ino);
    expect(after.dev).toBe(before.dev);
    expect(await readlink(linkPath)).toBe(
      "../../.pier/skills/library/review-guide"
    );
    const afterIdentity = await adapter.lstatIdentity(linkPath);
    expect(afterIdentity.dev).toBe(beforeIdentity.dev);
    expect(afterIdentity.ino).toBe(beforeIdentity.ino);
    expect(afterIdentity.mode).toBe(beforeIdentity.mode);
    expect(afterIdentity.isSymbolicLink).toBe(true);
  });

  it("creates a relative symlink with stable identity on first publish", async () => {
    const linkPath = join(root, ".agents", "skills", "review-guide");
    await mkdir(dirname(linkPath), { recursive: true });
    const adapter = createProjectSkillsFileSystemAdapter();
    const relativeTarget = "../../.pier/skills/library/review-guide";

    const result = await adapter.publishSymlinkNoReplace({
      linkPath,
      relativeTarget,
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error("expected created symlink");
    }
    expect(result.identity.isSymbolicLink).toBe(true);
    expect(result.identity.isDirectory).toBe(false);
    expect(await readlink(linkPath)).toBe(relativeTarget);

    const again = await adapter.lstatIdentity(linkPath);
    expect(again.dev).toBe(result.identity.dev);
    expect(again.ino).toBe(result.identity.ino);
    expect(again.mode).toBe(result.identity.mode);
    expect(again.isSymbolicLink).toBe(true);
  });

  it("rejects publishSymlink when an ancestor under projectRoot is a symlink", async () => {
    await symlink(outside, join(root, ".agents"));
    // Create the skills parent outside the project via the escaped symlink.
    await mkdir(join(outside, "skills"), { recursive: true });
    const linkPath = join(root, ".agents", "skills", "review-guide");
    const adapter = createProjectSkillsFileSystemAdapter();

    const result = await adapter.publishSymlinkNoReplace({
      linkPath,
      projectRoot: root,
      relativeTarget: "../../.pier/skills/library/review-guide",
    });

    expect(result).toEqual({
      reason: "parent-invalid",
      status: "conflict",
    });
    await expect(readdir(join(outside, "skills"))).resolves.toEqual([]);
  });

  it("does not report matched when the target changes after the final check", async () => {
    const targetPath = join(root, ".pier", "skills", "manifest.json");
    await mkdir(dirname(targetPath), { recursive: true });
    const original = Buffer.from('{"version":1,"skills":[]}\n');
    await writeFile(targetPath, original);
    const adapter = createProjectSkillsFileSystemAdapter();
    const expectedIdentity = await adapter.lstatIdentity(targetPath);
    const expectedDigest = createHash("sha256").update(original).digest("hex");
    const replacement = Buffer.from(
      '{"version":1,"skills":[{"id":"review-guide"}]}\n'
    );

    const result = await adapter.publishFileReplaceIfUnchanged({
      beforePublish: async () => {
        await writeFile(
          targetPath,
          Buffer.from('{"version":1,"hijacked":true}\n')
        );
      },
      bytes: replacement,
      digestOf: (bytes) => createHash("sha256").update(bytes).digest("hex"),
      expected: {
        digest: expectedDigest,
        identity: expectedIdentity,
        kind: "present",
      },
      path: targetPath,
    });

    expect(
      result.status === "conflict" || result.status === "indeterminate"
    ).toBe(true);
    if (result.status === "replaced") {
      throw new Error("must not silently match after external rewrite");
    }
    if (result.status === "conflict") {
      expect(["target-changed", "target-missing"]).toContain(result.reason);
    } else {
      expect(["post-check-diverged", "sync-unknown"]).toContain(result.reason);
    }
  });

  it("maps parent directory sync failure to indeterminate sync-unknown", async () => {
    const targetPath = join(root, ".pier", "skills", "manifest.json");
    await mkdir(dirname(targetPath), { recursive: true });
    const original = Buffer.from('{"version":1}\n');
    await writeFile(targetPath, original);
    const syncDirectory = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("directory fsync failed"));
    const adapter = createProjectSkillsFileSystemAdapter({ syncDirectory });
    const expectedIdentity = await adapter.lstatIdentity(targetPath);
    const replacement = Buffer.from('{"version":2}\n');

    const result = await adapter.publishFileReplaceIfUnchanged({
      bytes: replacement,
      digestOf: (bytes) => createHash("sha256").update(bytes).digest("hex"),
      expected: {
        digest: createHash("sha256").update(original).digest("hex"),
        identity: expectedIdentity,
        kind: "present",
      },
      path: targetPath,
    });

    expect(result).toEqual({
      reason: "sync-unknown",
      status: "indeterminate",
    });
    await expect(readFile(targetPath)).resolves.toEqual(replacement);
  });

  it("probes local-reliable capabilities on a writable temporary root", async () => {
    const adapter = createProjectSkillsFileSystemAdapter();
    const capabilities = await adapter.probeCapabilities(root);
    expect(capabilities).toMatchObject({
      kind: "local-reliable",
      supportsDirSync: true,
      supportsNoFollow: true,
      writable: true,
    });
  });
});

describe("project skills path containment (§6.1)", () => {
  it("ensureProjectRelativeDir refuses when .agents is a symlink out of project", async () => {
    await symlink(outside, join(root, ".agents"));
    const before = await readdir(outside);

    await expect(
      ensureProjectRelativeDir(root, ".agents/skills")
    ).rejects.toThrow(/symbolic link/i);

    expect(await readdir(outside)).toEqual(before);
    await expect(lstat(join(outside, "skills"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ensureProjectRelativeDir refuses when .pier is a symlink out of project", async () => {
    await symlink(outside, join(root, ".pier"));
    const before = await readdir(outside);

    await expect(
      ensureProjectRelativeDir(root, ".pier/skills/library")
    ).rejects.toThrow(/symbolic link/i);

    expect(await readdir(outside)).toEqual(before);
    await expect(lstat(join(outside, "skills"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("assertProjectRelativeAncestorsReal rejects symlink ancestors and allows missing", async () => {
    await symlink(outside, join(root, ".agents"));

    await expect(
      assertProjectRelativeAncestorsReal(root, ".agents/skills")
    ).rejects.toThrow(/symbolic link/i);

    await expect(
      assertProjectRelativeAncestorsReal(root, ".claude/skills")
    ).resolves.toBeUndefined();
  });

  it("ensureProjectRelativeDir creates nested real directories inside the project", async () => {
    await ensureProjectRelativeDir(root, ".pier/skills/library");
    const info = await lstat(join(root, ".pier", "skills", "library"));
    expect(info.isDirectory()).toBe(true);
    expect(info.isSymbolicLink()).toBe(false);
  });
});
