import { GitExecNulRecordParser } from "@main/services/git-exec-nul-record-parser.ts";
import {
  GIT_REVIEW_INDEX_ENTRY_LIMIT,
  GIT_REVIEW_INDEX_MAX_NUL_RECORDS,
  GIT_REVIEW_INDEX_PRIMARY_FACT_LIMIT,
  GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
  GitReviewIndexProtocolError,
} from "@main/services/git-review/git-review-index-contract.ts";
import { GitReviewNumstatParser } from "@main/services/git-review/git-review-index-numstat-parser.ts";
import { GitReviewPorcelainV2Parser } from "@main/services/git-review/git-review-index-primary-parser.ts";
import { GitReviewRawDiffParser } from "@main/services/git-review/git-review-index-raw-parser.ts";
import { describe, expect, it } from "vitest";

const sha1 = "1".repeat(40);
const sha1New = "2".repeat(40);

describe("Git review index byte protocol", () => {
  it("parses porcelain v2 groups without splitting whitespace inside paths", () => {
    const parser = new GitReviewPorcelainV2Parser();
    expect(
      parser.push(
        Buffer.from(
          `1 AM N... 100644 100644 100644 ${sha1} ${sha1} src/a\tb\n.ts`
        )
      )
    ).toBe("continue");
    parser.push(
      Buffer.from(
        `2 R. N... 100644 100644 100644 ${sha1} ${sha1} R100 :(glob)new.ts`
      )
    );
    parser.push(Buffer.from("-old.ts"));
    parser.push(Buffer.from("? leading space.ts"));
    parser.push(
      Buffer.from(
        `u UU N... 100644 100644 100644 100644 ${sha1} ${sha1} ${sha1} conflict.ts`
      )
    );

    const result = parser.finish();
    expect(result.entries).toMatchObject([
      {
        groupFacts: {
          staged: { status: "added" },
          unstaged: { status: "modified" },
        },
        path: "src/a\tb\n.ts",
      },
      {
        groupFacts: {
          staged: { oldPath: "-old.ts", status: "renamed" },
        },
        path: ":(glob)new.ts",
      },
      { groupFacts: { unstaged: { status: "added" } } },
      {
        groupFacts: { conflict: { status: "conflicted" } },
        path: "conflict.ts",
      },
    ]);
    expect(result.invalidPathEntries).toBe(0);
  });

  it("skips a whole logical item when either rename path is invalid UTF-8", () => {
    const parser = new GitReviewPorcelainV2Parser();
    parser.push(
      Buffer.from(
        `2 R. N... 100644 100644 100644 ${sha1} ${sha1} R100 valid.ts`
      )
    );
    parser.push(Buffer.from([0xc3, 0x28]));

    expect(parser.finish()).toMatchObject({
      entries: [],
      invalidPathEntries: 1,
    });
  });

  it("index digest 只跟踪 index 投影，不被纯 worktree mode 改变污染", () => {
    const clean = new GitReviewPorcelainV2Parser();
    const ordinary = new GitReviewPorcelainV2Parser();
    ordinary.push(
      Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} file.ts`)
    );
    const typeChanged = new GitReviewPorcelainV2Parser();
    typeChanged.push(
      Buffer.from(`1 .T N... 100644 100644 120000 ${sha1} ${sha1} file.ts`)
    );
    const stagedChanged = new GitReviewPorcelainV2Parser();
    stagedChanged.push(
      Buffer.from(`1 MM N... 100644 100644 100644 ${sha1} ${sha1New} file.ts`)
    );

    const cleanDigest = clean.finish().indexDigest;
    expect(ordinary.finish().indexDigest).toBe(cleanDigest);
    expect(typeChanged.finish().indexDigest).toBe(cleanDigest);
    expect(stagedChanged.finish().indexDigest).not.toBe(cleanDigest);
  });

  it("2,000 条双 group 记录恰好占用 4,000 facts，下一完整 tuple 整体截断", () => {
    const record = Buffer.from(
      `1 MM N... 100644 100644 100644 ${sha1} ${sha1New} file.ts`
    );
    const exactParser = new GitReviewPorcelainV2Parser();
    for (let index = 0; index < GIT_REVIEW_INDEX_ENTRY_LIMIT; index += 1) {
      expect(exactParser.push(record)).toBe("continue");
    }
    expect(GIT_REVIEW_INDEX_PRIMARY_FACT_LIMIT).toBe(4000);
    const exactResult = exactParser.finish();
    expect(exactResult).toMatchObject({
      entries: { length: 2000 },
      truncated: false,
    });

    const overflowParser = new GitReviewPorcelainV2Parser();
    for (let index = 0; index < GIT_REVIEW_INDEX_ENTRY_LIMIT; index += 1) {
      overflowParser.push(record);
    }
    expect(overflowParser.push(record)).toBe("stop");
    const overflowResult = overflowParser.finish();
    expect(overflowResult).toMatchObject({
      entries: { length: 2000 },
      truncated: true,
    });
    expect(overflowResult.indexDigest).toBe(exactResult.indexDigest);
    expect(overflowResult.digestByGroup).toEqual(exactResult.digestByGroup);
  });

  it("4,001 个单 fact rename 跨 chunk 在第 8,002 条 record 后停止", () => {
    const parser = new GitReviewPorcelainV2Parser();
    const transport = new GitExecNulRecordParser();
    const records = Array.from(
      { length: GIT_REVIEW_INDEX_PRIMARY_FACT_LIMIT + 1 },
      (_, index) => [
        Buffer.from(
          `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R100 new-${index}.ts`
        ),
        Buffer.from(`old-${index}.ts`),
      ]
    ).flat();
    const stream = Buffer.concat(
      records.flatMap((record) => [record, Buffer.from([0])])
    );
    let completeRecords = 0;
    for (let offset = 0; offset < stream.length; offset += 137) {
      const keepReading = transport.push(
        stream.subarray(offset, Math.min(stream.length, offset + 137)),
        (record) => {
          completeRecords += 1;
          return parser.push(record) === "continue";
        }
      );
      if (!keepReading) {
        break;
      }
    }

    expect(completeRecords).toBe(GIT_REVIEW_INDEX_MAX_NUL_RECORDS);
    expect(parser.finish()).toMatchObject({
      entries: { length: 4000 },
      truncated: true,
    });
  });

  it("parses raw ordinary, typechange, rename, and copy tuples", () => {
    const parser = new GitReviewRawDiffParser("commit");
    parser.push(Buffer.from(`:100644 100644 ${sha1} ${sha1New} M`));
    parser.push(Buffer.from("modified.ts"));
    parser.push(Buffer.from(`:100644 120000 ${sha1} ${sha1New} T`));
    parser.push(Buffer.from("link.ts"));
    parser.push(Buffer.from(`:100644 100644 ${sha1} ${sha1New} R087`));
    parser.push(Buffer.from("old.ts"));
    parser.push(Buffer.from("renamed.ts"));
    parser.push(Buffer.from(`:100644 100644 ${sha1} ${sha1New} C100`));
    parser.push(Buffer.from("source.ts"));
    parser.push(Buffer.from("copy.ts"));

    const result = parser.finish();
    expect(result.entries).toMatchObject([
      { groupFacts: { commit: { status: "modified" } }, path: "modified.ts" },
      { groupFacts: { commit: { status: "modified" } }, path: "link.ts" },
      {
        groupFacts: { commit: { oldPath: "old.ts", status: "renamed" } },
        path: "renamed.ts",
      },
      {
        groupFacts: {
          commit: { oldPath: "source.ts", status: "renamed" },
        },
        path: "copy.ts",
      },
    ]);
  });

  it("parses numstat rename and keeps binary counts null", () => {
    const parser = new GitReviewNumstatParser("commit");
    parser.push(Buffer.from("12\t3\tplain\tpath.ts"));
    parser.push(Buffer.from("4\t5\t"));
    parser.push(Buffer.from("old\npath.ts"));
    parser.push(Buffer.from("new\npath.ts"));
    parser.push(Buffer.from("-\t-\tbinary.dat"));

    expect(parser.finish().entries).toEqual([
      {
        additions: 12,
        deletions: 3,
        oldPath: null,
        path: "plain\tpath.ts",
      },
      {
        additions: 4,
        deletions: 5,
        oldPath: "old\npath.ts",
        path: "new\npath.ts",
      },
      {
        additions: null,
        deletions: null,
        oldPath: null,
        path: "binary.dat",
      },
    ]);
  });

  it("rejects malformed metadata and incomplete multi-record tuples", () => {
    expect(() => {
      const parser = new GitReviewRawDiffParser("branch");
      parser.push(Buffer.from(`:100644 100644 ${sha1} ${sha1New} R100`));
      parser.push(Buffer.from("old.ts"));
      parser.finish();
    }).toThrow(GitReviewIndexProtocolError);
    expect(() => {
      const parser = new GitReviewNumstatParser("commit");
      parser.push(Buffer.from("-\t1\tbad.ts"));
    }).toThrow(GitReviewIndexProtocolError);
    expect(() => {
      const parser = new GitReviewPorcelainV2Parser();
      parser.push(
        Buffer.from(
          `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} C100 bad.ts`
        )
      );
      parser.push(Buffer.from("old.ts"));
    }).toThrow(GitReviewIndexProtocolError);
    expect(() => {
      const parser = new GitReviewPorcelainV2Parser();
      parser.push(
        Buffer.from(
          `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R101 bad.ts`
        )
      );
      parser.push(Buffer.from("old.ts"));
    }).toThrow(GitReviewIndexProtocolError);
  });

  it("NUL chunk parser 串联读取 2000 个 rename，并只在完整第 2001 项后停止", () => {
    expect(GIT_REVIEW_INDEX_MAX_NUL_RECORDS).toBe(8002);
    expect(GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS).toBe(6003);
    const parser = new GitReviewRawDiffParser("branch");
    const transport = new GitExecNulRecordParser();
    const records = Array.from(
      { length: GIT_REVIEW_INDEX_ENTRY_LIMIT + 1 },
      (_, index) => [
        Buffer.from(`:100644 100644 ${sha1} ${sha1New} R100`),
        Buffer.from(`old-${index}`),
        Buffer.from(`new-${index}`),
      ]
    ).flat();
    const stream = Buffer.concat(
      records.flatMap((record) => [record, Buffer.from([0])])
    );
    let completeRecords = 0;
    for (let offset = 0; offset < stream.length; offset += 137) {
      const keepReading = transport.push(
        stream.subarray(offset, Math.min(stream.length, offset + 137)),
        (record) => {
          completeRecords += 1;
          return parser.push(record) === "continue";
        }
      );
      if (!keepReading) {
        break;
      }
    }

    expect(completeRecords).toBe(6003);
    expect(parser.finish()).toMatchObject({
      entries: { length: 2000 },
      truncated: true,
    });
  });

  it("2,000 个非法 UTF-8 双 group 项耗尽 4,000 facts，不能绕过上限", () => {
    const parser = new GitReviewPorcelainV2Parser();
    const prefix = Buffer.from(
      `1 MM N... 100644 100644 100644 ${sha1} ${sha1} `
    );
    for (let index = 0; index < GIT_REVIEW_INDEX_ENTRY_LIMIT; index += 1) {
      expect(
        parser.push(Buffer.concat([prefix, Buffer.from([0xc3, 0x28])]))
      ).toBe("continue");
    }
    expect(
      parser.push(
        Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} valid.ts`)
      )
    ).toBe("stop");

    expect(parser.finish()).toMatchObject({
      entries: [],
      invalidPathEntries: 2000,
      truncated: true,
    });
  });

  it("numstat rename 在第 2,001 个完整 tuple 的第 6,003 条 record 后截断", () => {
    const parser = new GitReviewNumstatParser("commit");
    let completeRecords = 0;
    let decision: "continue" | "stop" = "continue";
    for (let index = 0; index <= GIT_REVIEW_INDEX_ENTRY_LIMIT; index += 1) {
      for (const record of [
        Buffer.from("1\t1\t"),
        Buffer.from(`old-${index}.ts`),
        Buffer.from(`new-${index}.ts`),
      ]) {
        completeRecords += 1;
        decision = parser.push(record);
        if (decision === "stop") {
          break;
        }
      }
      if (decision === "stop") {
        break;
      }
    }

    expect(decision).toBe("stop");
    expect(completeRecords).toBe(GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS);
    expect(parser.finish()).toMatchObject({
      entries: { length: 2000 },
      truncated: true,
    });
  });
});
