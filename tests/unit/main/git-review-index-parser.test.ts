import { GitExecNulRecordParser } from "@main/services/git-exec-nul-record-parser.ts";
import { GitReviewIndexProtocolError } from "@main/services/git-review/git-review-index-contract.ts";
import { GitReviewNumstatParser } from "@main/services/git-review/git-review-index-numstat-parser.ts";
import { GitReviewPorcelainV2Parser } from "@main/services/git-review/git-review-index-primary-parser.ts";
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
          staged: { sourceOid: sha1, status: "added", targetOid: sha1 },
          unstaged: {
            sourceOid: sha1,
            status: "modified",
            targetOid: null,
          },
        },
        path: "src/a\tb\n.ts",
      },
      {
        groupFacts: {
          staged: {
            oldPath: "-old.ts",
            sourceOid: sha1,
            status: "renamed",
            targetOid: sha1,
          },
        },
        path: ":(glob)new.ts",
      },
      {
        groupFacts: {
          unstaged: { sourceOid: null, status: "added", targetOid: null },
        },
      },
      {
        groupFacts: {
          conflict: {
            sourceOid: null,
            status: "conflicted",
            targetOid: null,
          },
        },
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

  it("超过 2,000 条双 group 记录仍完整解析", () => {
    const record = Buffer.from(
      `1 MM N... 100644 100644 100644 ${sha1} ${sha1New} file.ts`
    );
    const parser = new GitReviewPorcelainV2Parser();
    for (let index = 0; index < 2001; index += 1) {
      expect(parser.push(record)).toBe("continue");
    }
    expect(parser.finish()).toMatchObject({ entries: { length: 2001 } });
  });

  it("4,001 个单 fact rename 跨 chunk 全部解析", () => {
    const parser = new GitReviewPorcelainV2Parser();
    const transport = new GitExecNulRecordParser();
    const records = Array.from({ length: 4001 }, (_, index) => [
      Buffer.from(
        `2 R. N... 100644 100644 100644 ${sha1} ${sha1New} R100 new-${index}.ts`
      ),
      Buffer.from(`old-${index}.ts`),
    ]).flat();
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

    expect(completeRecords).toBe(8002);
    expect(parser.finish()).toMatchObject({ entries: { length: 4001 } });
  });

  it("parses numstat plain/rename/binary records into a stable digest", () => {
    const parser = new GitReviewNumstatParser("staged");
    parser.push(Buffer.from("12\t3\tplain\tpath.ts"));
    parser.push(Buffer.from("4\t5\t"));
    parser.push(Buffer.from("old\npath.ts"));
    parser.push(Buffer.from("new\npath.ts"));
    parser.push(Buffer.from("-\t-\tbinary.dat"));

    expect(parser.finish()).toMatchObject({
      digest: expect.stringMatching(/^sha256:/u),
    });
  });

  it("rejects malformed metadata and incomplete multi-record tuples", () => {
    expect(() => {
      const parser = new GitReviewNumstatParser("staged");
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

  it("非法 UTF-8 项不占用文件数量门槛，后续合法项仍被接纳", () => {
    const parser = new GitReviewPorcelainV2Parser();
    const prefix = Buffer.from(
      `1 MM N... 100644 100644 100644 ${sha1} ${sha1} `
    );
    for (let index = 0; index < 2000; index += 1) {
      expect(
        parser.push(Buffer.concat([prefix, Buffer.from([0xc3, 0x28])]))
      ).toBe("continue");
    }
    expect(
      parser.push(
        Buffer.from(`1 .M N... 100644 100644 100644 ${sha1} ${sha1} valid.ts`)
      )
    ).toBe("continue");

    expect(parser.finish()).toMatchObject({
      entries: [{ path: "valid.ts" }],
      invalidPathEntries: 2000,
    });
  });

  it("numstat rename 超过 2,000 个完整 tuple 后仍继续", () => {
    const parser = new GitReviewNumstatParser("commit");
    let completeRecords = 0;
    let decision: "continue" | "stop" = "continue";
    for (let index = 0; index < 2001; index += 1) {
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

    expect(decision).toBe("continue");
    expect(completeRecords).toBe(6003);
    expect(parser.finish()).toMatchObject({
      digest: expect.stringMatching(/^sha256:/u),
    });
  });
});
