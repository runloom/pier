import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createFileSafeWriter } from "@main/services/file-safe-writer.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-safe-writer-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("file safe writer", () => {
  it("publishes absent targets without replacing a racing creator", async () => {
    const beforePublish = vi.fn(async () => {
      await writeFile(join(root, "notes.txt"), "external\n");
    });
    const writer = createFileSafeWriter({ beforePublish });

    await expect(
      writer.write({
        bytes: Buffer.from("pier\n"),
        expected: { kind: "absent" },
        path: "notes.txt",
        root,
      })
    ).resolves.toEqual({ kind: "conflict", reason: "target-exists" });
    await expect(readFile(join(root, "notes.txt"), "utf8")).resolves.toBe(
      "external\n"
    );
  });

  it("preserves executable mode when atomically replacing a file", async () => {
    await writeFile(join(root, "script.sh"), "old\n");
    await chmod(join(root, "script.sh"), 0o755);
    const writer = createFileSafeWriter();
    const inspected = await writer.inspectRevision({
      path: "script.sh",
      root,
    });

    const result = await writer.write({
      bytes: Buffer.from("new\n"),
      expected: { kind: "revision", revision: inspected.revision },
      path: "script.sh",
      root,
    });

    expect(result).toMatchObject({
      durability: "confirmed",
      kind: "written",
      mode: 0o755,
    });
    expect((await stat(join(root, "script.sh"))).mode % 0o1000).toBe(0o755);
  });

  it.runIf(process.platform === "darwin")(
    "preserves macOS ACLs and extended attributes",
    async () => {
      const target = join(root, "metadata.txt");
      await writeFile(target, "old\n");
      const username = (
        await execFileAsync("/usr/bin/id", ["-un"], { encoding: "utf8" })
      ).stdout.trim();
      await execFileAsync(
        "/bin/chmod",
        ["+a", `user:${username} allow read,write`, target],
        { encoding: "utf8" }
      );
      await execFileAsync("/usr/bin/chflags", ["hidden", target], {
        encoding: "utf8",
      });
      await execFileAsync(
        "/usr/bin/xattr",
        ["-w", "com.pier.file-test", "preserved", target],
        { encoding: "utf8" }
      );
      const writer = createFileSafeWriter();
      const inspected = await writer.inspectRevision({
        path: "metadata.txt",
        root,
      });

      await expect(
        writer.write({
          bytes: Buffer.from("new\n"),
          expected: { kind: "revision", revision: inspected.revision },
          path: "metadata.txt",
          root,
        })
      ).resolves.toMatchObject({ kind: "written" });
      const value = await execFileAsync(
        "/usr/bin/xattr",
        ["-p", "com.pier.file-test", target],
        { encoding: "utf8" }
      );
      expect(value.stdout.trim()).toBe("preserved");
      const acl = await execFileAsync("/bin/ls", ["-le", target], {
        encoding: "utf8",
      });
      expect(acl.stdout).toContain(`user:${username} allow read,write`);
      const flags = await execFileAsync(
        "/usr/bin/stat",
        ["-f", "%Sf", target],
        { encoding: "utf8" }
      );
      expect(flags.stdout).toContain("hidden");
    }
  );

  it("refuses to break a hard-link set during atomic replacement", async () => {
    await writeFile(join(root, "first.txt"), "old\n");
    await link(join(root, "first.txt"), join(root, "second.txt"));
    const writer = createFileSafeWriter();
    const inspected = await writer.inspectRevision({
      path: "first.txt",
      root,
    });

    await expect(
      writer.write({
        bytes: Buffer.from("new\n"),
        expected: { kind: "revision", revision: inspected.revision },
        path: "first.txt",
        root,
      })
    ).resolves.toMatchObject({
      kind: "not-writable",
      message: expect.stringContaining("hard links"),
    });
    await expect(readFile(join(root, "second.txt"), "utf8")).resolves.toBe(
      "old\n"
    );
  });

  it("writes through an in-root symlink without replacing the link", async () => {
    await writeFile(join(root, "target.txt"), "old\n");
    await symlink("target.txt", join(root, "alias.txt"));
    const writer = createFileSafeWriter();
    const inspected = await writer.inspectRevision({
      path: "alias.txt",
      root,
    });

    const result = await writer.write({
      bytes: Buffer.from("new\n"),
      expected: { kind: "revision", revision: inspected.revision },
      path: "alias.txt",
      root,
    });

    expect(result.kind).toBe("written");
    expect((await lstat(join(root, "alias.txt"))).isSymbolicLink()).toBe(true);
    await expect(readFile(join(root, "target.txt"), "utf8")).resolves.toBe(
      "new\n"
    );
  });

  it("serializes same-target writes and allows only one stale revision", async () => {
    await writeFile(join(root, "notes.txt"), "old\n");
    const writer = createFileSafeWriter();
    const inspected = await writer.inspectRevision({
      path: "notes.txt",
      root,
    });

    const results = await Promise.all([
      writer.write({
        bytes: Buffer.from("first\n"),
        expected: { kind: "revision", revision: inspected.revision },
        path: "notes.txt",
        root,
      }),
      writer.write({
        bytes: Buffer.from("second\n"),
        expected: { kind: "revision", revision: inspected.revision },
        path: "notes.txt",
        root,
      }),
    ]);

    expect(results.filter((result) => result.kind === "written")).toHaveLength(
      1
    );
    expect(results.filter((result) => result.kind === "conflict")).toEqual([
      { kind: "conflict", reason: "revision-mismatch" },
    ]);
  });

  it("reports a committed write with unknown durability when directory sync fails", async () => {
    const syncDirectory = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("directory fsync failed"))
      .mockResolvedValue(undefined);
    const writer = createFileSafeWriter({ syncDirectory });

    const result = await writer.write({
      bytes: Buffer.from("committed\n"),
      expected: { kind: "absent" },
      path: "notes.txt",
      root,
    });

    expect(result).toMatchObject({
      committed: true,
      durability: "unknown",
      kind: "written",
    });
    await expect(readFile(join(root, "notes.txt"), "utf8")).resolves.toBe(
      "committed\n"
    );
    if (result.kind !== "written") {
      throw new Error("expected committed write");
    }
    await expect(
      writer.confirmDurability({
        expectedRevision: result.revision,
        path: "notes.txt",
        root,
      })
    ).resolves.toEqual({
      kind: "confirmed",
      revision: result.revision,
    });
  });

  it("does not report failure after an absent target has been committed", async () => {
    const writer = createFileSafeWriter({
      unlinkFile: vi.fn(async () => {
        throw new Error("temporary cleanup failed");
      }),
    });

    const result = await writer.write({
      bytes: Buffer.from("committed\n"),
      expected: { kind: "absent" },
      path: "notes.txt",
      root,
    });

    expect(result).toMatchObject({
      committed: true,
      durability: "unknown",
      kind: "written",
    });
    await expect(readFile(join(root, "notes.txt"), "utf8")).resolves.toBe(
      "committed\n"
    );
  });

  it("confirms durability without rewriting content and detects revision changes", async () => {
    await writeFile(join(root, "notes.txt"), "stable\n");
    const writer = createFileSafeWriter();
    const inspected = await writer.inspectRevision({
      path: "notes.txt",
      root,
    });
    const before = await stat(join(root, "notes.txt"));

    await expect(
      writer.confirmDurability({
        expectedRevision: inspected.revision,
        path: "notes.txt",
        root,
      })
    ).resolves.toEqual({
      kind: "confirmed",
      revision: inspected.revision,
    });
    expect((await stat(join(root, "notes.txt"))).ino).toBe(before.ino);

    await writeFile(join(root, "notes.txt"), "changed\n");
    await expect(
      writer.confirmDurability({
        expectedRevision: inspected.revision,
        path: "notes.txt",
        root,
      })
    ).resolves.toEqual({ kind: "revision-mismatch" });
  });
});

import { execFile } from "node:child_process";
