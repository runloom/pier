import { GitReviewBudget } from "@main/services/git-review/git-review-budget.ts";
import { materialFromGitReviewPatchEnvelope } from "@main/services/git-review/git-review-document-envelope.ts";
import {
  GitReviewPatchEnvelopeSelector,
  selectGitReviewPatchEnvelope,
} from "@main/services/git-review/git-review-document-envelope-selector.ts";
import {
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
  readGitReviewPatch,
} from "@main/services/git-review/git-review-document-patch.ts";
import {
  GIT_REVIEW_PATCH_MAX_BYTES,
  type ReadGitReviewPatchOptions,
} from "@main/services/git-review/git-review-document-patch-contract.ts";
import { describe, expect, it, vi } from "vitest";

const oid = "1".repeat(40);

function options(
  overrides: Partial<ReadGitReviewPatchOptions> = {}
): ReadGitReviewPatchOptions {
  return {
    budget: new GitReviewBudget(),
    execGitRaw: vi.fn(),
    fact: {
      movement: null,
      oldPath: null,
      origin: "tracked",
      sourceOid: null,
      statsExpected: true,
      status: "modified",
      targetOid: null,
      targetPath: "file.ts",
    },
    gitRootPath: "/repo",
    group: "unstaged",
    headOid: oid,
    ...overrides,
  };
}

function envelope(
  records: readonly string[],
  patch = "diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\n"
): Buffer {
  return Buffer.concat([
    ...records.flatMap((record) => [
      Buffer.from(record, "utf8"),
      Buffer.from([0]),
    ]),
    Buffer.from([0]),
    Buffer.from(patch, "utf8"),
  ]);
}

function material(
  stdout: Buffer,
  readOptions: ReadGitReviewPatchOptions = options()
) {
  return materialFromGitReviewPatchEnvelope(
    selectGitReviewPatchEnvelope(stdout, readOptions.fact),
    readOptions
  );
}

describe("Git Review patch envelope", () => {
  it("跨任意 chunk 边界只保留目标 section", () => {
    const input = envelope(
      [
        `:100644 100644 ${oid} ${oid} M`,
        "other.ts",
        `:100644 100644 ${oid} ${oid} M`,
        "file.ts",
      ],
      [
        "diff --git a/other.ts b/other.ts\n@@ -1 +1 @@\n-old\n+other\n",
        "diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+selected\n",
      ].join("")
    );
    const selector = new GitReviewPatchEnvelopeSelector(options().fact);
    for (let offset = 0; offset < input.length; offset += 7) {
      selector.push(input.subarray(offset, offset + 7));
    }

    const selected = materialFromGitReviewPatchEnvelope(
      selector.finish(),
      options()
    );

    expect(selected).toMatchObject({ kind: "patch" });
    expect(selected.kind === "patch" && selected.patch).toContain("+selected");
    expect(selected.kind === "patch" && selected.patch).not.toContain("+other");
  });

  it("流式解析一旦识别协议错误立即抛出", () => {
    const selector = new GitReviewPatchEnvelopeSelector(options().fact);

    expect(() => selector.push(Buffer.alloc(64 * 1024 + 1, 0x61))).toThrow(
      GitReviewDocumentProtocolError
    );
  });

  it("流式解析拒绝非法的全局正文起始段", () => {
    const input = envelope(
      [
        `:100644 100644 ${oid} ${oid} M`,
        "other.ts",
        `:100644 100644 ${oid} ${oid} M`,
        "file.ts",
      ],
      "invalid first section\ndiff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\n"
    );
    const selector = new GitReviewPatchEnvelopeSelector(options().fact);

    expect(() => selector.push(input)).toThrow(GitReviewDocumentProtocolError);
  });

  it.each([
    ["protocol", Buffer.alloc(64 * 1024 + 1, 0x61)],
    [
      "output-limit",
      envelope(
        [`:100644 100644 ${oid} ${oid} M`, "file.ts"],
        `diff --git a/file.ts b/file.ts\n${"x".repeat(
          GIT_REVIEW_PATCH_MAX_BYTES + 64 * 1024
        )}`
      ),
    ],
  ] as const)("保留 chunks consumer 内的 %s typed 错误", async (_name, chunk) => {
    const wrapped = new Error("record-consumer wrapper");
    const readOptions = options({
      execGitRaw: async (_args, execOptions) => {
        if (execOptions.mode !== "chunks") {
          throw new Error("expected chunks mode");
        }
        try {
          execOptions.onStdoutChunk(chunk);
        } catch {
          throw wrapped;
        }
        throw new Error("expected selector failure");
      },
      group: "staged",
    });

    const error = await readGitReviewPatch(readOptions).catch(
      (reason: unknown) => reason
    );

    if (_name === "protocol") {
      expect(error).toBeInstanceOf(GitReviewDocumentProtocolError);
    } else {
      expect(error).toMatchObject({ kind: "output-limit" });
    }
    expect(error).not.toBe(wrapped);
  });

  it("接受 typechange 作为 modified patch", () => {
    const result = material(
      envelope([`:100644 100755 ${oid} ${oid} T`, "file.ts"])
    );

    expect(result).toMatchObject({ kind: "patch" });
  });

  it("拒绝多文件 raw envelope 与错误路径，不能把 pathspec 回归带入 UI", () => {
    const multiple = envelope([
      `:100644 100644 ${oid} ${oid} M`,
      "file.ts",
      `:100644 100644 ${oid} ${oid} M`,
      "other.ts",
    ]);
    const wrongPath = envelope([`:100644 100644 ${oid} ${oid} M`, "other.ts"]);

    expect(() => material(multiple)).toThrow(GitReviewDocumentProtocolError);
    expect(() => material(wrongPath)).toThrow(GitReviewDocumentStaleError);
  });

  it("rename 必须同时匹配 oldPath、targetPath 和状态", () => {
    const rename = envelope([
      `:100644 100644 ${oid} ${oid} R100`,
      "old.ts",
      "new.ts",
    ]);

    expect(
      material(
        rename,
        options({
          fact: {
            movement: "rename",
            oldPath: "old.ts",
            origin: "tracked",
            sourceOid: null,
            statsExpected: true,
            status: "renamed",
            targetOid: null,
            targetPath: "new.ts",
          },
        })
      )
    ).toMatchObject({ kind: "patch" });
    expect(() =>
      material(
        rename,
        options({
          fact: {
            movement: "rename",
            oldPath: "different.ts",
            origin: "tracked",
            sourceOid: null,
            statsExpected: true,
            status: "renamed",
            targetOid: null,
            targetPath: "new.ts",
          },
        })
      )
    ).toThrow(GitReviewDocumentStaleError);
  });

  it("严格拒绝缺失、越界或出现在普通状态后的 rename score", () => {
    for (const status of ["R", "C101", "M50"]) {
      expect(() =>
        material(
          envelope([`:100644 100644 ${oid} ${oid} ${status}`, "file.ts"]),
          options()
        )
      ).toThrow(GitReviewDocumentProtocolError);
    }
  });

  it("只把 Git 协议完整行识别为 binary，不误判源码中的标记字样", () => {
    const text = material(
      envelope(
        [`:100644 100644 ${oid} ${oid} M`, "file.ts"],
        'diff --git a/file.ts b/file.ts\n@@ -0,0 +1 @@\n+const marker = "GIT binary patch";\n'
      ),
      options()
    );
    const binary = material(
      envelope(
        [`:100644 100644 ${oid} ${oid} M`, "file.ts"],
        "diff --git a/file.ts b/file.ts\nGIT binary patch\nliteral 0\nHcmV?d00001\n"
      ),
      options()
    );

    expect(text).toMatchObject({ kind: "patch" });
    expect(binary).toMatchObject({ kind: "state", reason: "binary" });
  });

  it("raw 只有一个文件时仍拒绝包含第二个 diff header 的 patch 正文", () => {
    expect(() =>
      material(
        envelope(
          [`:100644 100644 ${oid} ${oid} M`, "file.ts"],
          "diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/other.ts b/other.ts\n"
        ),
        options()
      )
    ).toThrow(GitReviewDocumentProtocolError);
  });
});
