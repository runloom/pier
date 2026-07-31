import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertTreeRelativePathConflicts,
  computeRiskFingerprint,
  computeTreeSha256V1,
} from "@main/services/project-skills/tree-digest.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pier-project-skills-tree-"));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function writeTree(
  base: string,
  files: Record<string, string | { content: string; mode?: number }>
): Promise<void> {
  for (const [relativePath, value] of Object.entries(files)) {
    const absolute = join(base, relativePath);
    await mkdir(join(absolute, ".."), { recursive: true });
    if (typeof value === "string") {
      await writeFile(absolute, value);
    } else {
      await writeFile(absolute, value.content, { mode: value.mode ?? 0o644 });
      if (value.mode !== undefined) {
        await chmod(absolute, value.mode);
      }
    }
  }
}

describe("project-skills tree-sha256-v1", () => {
  it("returns a stable sha256: digest for the same tree", async () => {
    await writeTree(root, {
      "SKILL.md": "---\nname: demo\n---\nbody\n",
      "scripts/run.sh": { content: "#!/bin/sh\necho hi\n", mode: 0o755 },
      "notes/readme.txt": "plain\n",
    });

    const first = await computeTreeSha256V1(root);
    const second = await computeTreeSha256V1(root);

    expect(first).toMatch(DIGEST_RE);
    expect(second).toBe(first);
  });

  it("is independent of mtime and only depends on path/type/length/content/exec", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    await writeTree(a, {
      "SKILL.md": "same-bytes",
      "bin/tool": { content: "#!/bin/sh\n", mode: 0o755 },
    });
    await writeTree(b, {
      "bin/tool": { content: "#!/bin/sh\n", mode: 0o755 },
      "SKILL.md": "same-bytes",
    });

    // Touch order / directory creation order differ; digest must match.
    expect(await computeTreeSha256V1(a)).toBe(await computeTreeSha256V1(b));
  });

  it("changes when executable bit changes", async () => {
    await writeTree(root, {
      "tool.sh": { content: "#!/bin/sh\n", mode: 0o644 },
    });
    const before = await computeTreeSha256V1(root);
    await chmod(join(root, "tool.sh"), 0o755);
    const after = await computeTreeSha256V1(root);
    expect(after).toMatch(DIGEST_RE);
    expect(after).not.toBe(before);
  });

  it("changes when file content changes", async () => {
    await writeTree(root, { "SKILL.md": "v1" });
    const before = await computeTreeSha256V1(root);
    await writeFile(join(root, "SKILL.md"), "v2");
    expect(await computeTreeSha256V1(root)).not.toBe(before);
  });

  it("rejects symbolic links", async () => {
    await writeTree(root, { "SKILL.md": "ok" });
    await symlink("SKILL.md", join(root, "link.md"));
    await expect(computeTreeSha256V1(root)).rejects.toThrow(/symlink/i);
  });

  it("rejects hard links", async () => {
    await writeTree(root, { "a.txt": "shared" });
    await link(join(root, "a.txt"), join(root, "b.txt"));
    await expect(computeTreeSha256V1(root)).rejects.toThrow(
      /hardlink|hard link/i
    );
  });

  it("rejects case-fold path conflicts", () => {
    expect(() =>
      assertTreeRelativePathConflicts(["Skill.md", "skill.md"])
    ).toThrow(/case-fold/i);
  });

  it("rejects unicode normalization path conflicts", () => {
    const nfc = "cafe\u00e9.txt";
    const nfd = "cafe\u0065\u0301.txt";
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFC")).toBe(nfd.normalize("NFC"));
    expect(() => assertTreeRelativePathConflicts([nfc, nfd])).toThrow(
      /unicode|normaliz/i
    );
  });
});

describe("project-skills riskFingerprint", () => {
  it("returns sha256: digest and is stable for identical inputs", () => {
    const treeFiles = [
      { relativePath: "SKILL.md", executable: false, bytes: Buffer.from("x") },
      {
        relativePath: "bin/run",
        executable: true,
        bytes: Buffer.from("#!/bin/sh\necho $(date)\n"),
      },
    ] as const;
    const frontmatter = {
      name: "demo",
      description: "d",
      "allowed-tools": ["Bash", "Read"],
    };

    const a = computeRiskFingerprint({ treeFiles, frontmatter });
    const b = computeRiskFingerprint({ treeFiles, frontmatter });
    expect(a).toMatch(DIGEST_RE);
    expect(b).toBe(a);
  });

  it("changes when executable set changes", () => {
    const base = {
      frontmatter: { name: "demo" } as Record<string, unknown>,
      treeFiles: [
        {
          relativePath: "tool.sh",
          executable: false,
          bytes: Buffer.from("#!/bin/sh\n"),
        },
      ],
    };
    const before = computeRiskFingerprint(base);
    const first = base.treeFiles[0];
    if (!first) {
      throw new Error("expected tree file");
    }
    const after = computeRiskFingerprint({
      ...base,
      treeFiles: [
        { ...first, executable: true, relativePath: first.relativePath },
      ],
    });
    expect(after).not.toBe(before);
  });

  it("changes when allowed-tools frontmatter changes", () => {
    const treeFiles = [
      { relativePath: "SKILL.md", executable: false, bytes: Buffer.from("x") },
    ];
    const before = computeRiskFingerprint({
      treeFiles,
      frontmatter: { "allowed-tools": ["Read"] },
    });
    const after = computeRiskFingerprint({
      treeFiles,
      frontmatter: { "allowed-tools": ["Read", "Bash"] },
    });
    expect(after).not.toBe(before);
  });

  it("changes when dynamic command traces appear in file bytes", () => {
    const frontmatter = { name: "demo" };
    const before = computeRiskFingerprint({
      frontmatter,
      treeFiles: [
        {
          relativePath: "x.sh",
          executable: true,
          bytes: Buffer.from("#!/bin/sh\necho hi\n"),
        },
      ],
    });
    const after = computeRiskFingerprint({
      frontmatter,
      treeFiles: [
        {
          relativePath: "x.sh",
          executable: true,
          bytes: Buffer.from('#!/bin/sh\neval "$1"\n'),
        },
      ],
    });
    expect(after).not.toBe(before);
  });

  it("ignores unrelated frontmatter fields that are not risk surfaces", () => {
    const treeFiles = [
      { relativePath: "SKILL.md", executable: false, bytes: Buffer.from("x") },
    ];
    const a = computeRiskFingerprint({
      treeFiles,
      frontmatter: { name: "a", description: "one" },
    });
    const b = computeRiskFingerprint({
      treeFiles,
      frontmatter: { name: "b", description: "two" },
    });
    expect(a).toBe(b);
  });
});

describe("project-skills tree digest format helpers", () => {
  it("matches contentDigestSchema shape used by contracts", () => {
    // sanity: contract regex frozen as sha256:[a-f0-9]{64}
    const sample = `sha256:${createHash("sha256").update("x").digest("hex")}`;
    expect(sample).toMatch(DIGEST_RE);
  });
});
