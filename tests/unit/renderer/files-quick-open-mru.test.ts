import {
  __resetFilesPathMruForTests,
  listFilesPathMru,
  recordFilesPathMru,
} from "@plugins/builtin/files/renderer/files-quick-open-mru.ts";
import { FILE_PATH_QUERY_MRU_MAX } from "@shared/contracts/file-query.ts";
import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  __resetFilesPathMruForTests();
});

describe("files quick-open MRU", () => {
  it("returns empty for an unrecorded root", () => {
    expect(listFilesPathMru("/repo")).toEqual([]);
  });

  it("records newest path first", () => {
    recordFilesPathMru("/repo", "src/a.ts");
    recordFilesPathMru("/repo", "src/b.ts");
    expect(listFilesPathMru("/repo")).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("moves a re-recorded path to the head without duplicating", () => {
    recordFilesPathMru("/repo", "src/a.ts");
    recordFilesPathMru("/repo", "src/b.ts");
    recordFilesPathMru("/repo", "src/c.ts");
    recordFilesPathMru("/repo", "src/a.ts");
    expect(listFilesPathMru("/repo")).toEqual([
      "src/a.ts",
      "src/c.ts",
      "src/b.ts",
    ]);
  });

  it("caps at FILE_PATH_QUERY_MRU_MAX and evicts the oldest", () => {
    for (let i = 0; i <= FILE_PATH_QUERY_MRU_MAX; i += 1) {
      recordFilesPathMru("/repo", `src/p${i}.ts`);
    }
    const list = listFilesPathMru("/repo");
    expect(list).toHaveLength(FILE_PATH_QUERY_MRU_MAX);
    expect(list[0]).toBe(`src/p${FILE_PATH_QUERY_MRU_MAX}.ts`);
    expect(list.at(-1)).toBe("src/p1.ts");
    expect(list.includes("src/p0.ts")).toBe(false);
  });

  it("isolates buckets per root", () => {
    recordFilesPathMru("/repo-a", "a.ts");
    recordFilesPathMru("/repo-b", "b.ts");
    expect(listFilesPathMru("/repo-a")).toEqual(["a.ts"]);
    expect(listFilesPathMru("/repo-b")).toEqual(["b.ts"]);
  });

  it("returns a snapshot copy; mutating the returned array must not leak", () => {
    recordFilesPathMru("/repo", "a.ts");
    const first = listFilesPathMru("/repo") as string[];
    first.push("stolen");
    expect(listFilesPathMru("/repo")).toEqual(["a.ts"]);
  });

  it("ignores empty root or path so a corrupt hint never poisons the bucket", () => {
    recordFilesPathMru("/repo", "");
    recordFilesPathMru("", "a.ts");
    expect(listFilesPathMru("/repo")).toEqual([]);
    expect(listFilesPathMru("")).toEqual([]);
  });

  it("is a no-op when a path is re-recorded already at the head", () => {
    recordFilesPathMru("/repo", "a.ts");
    recordFilesPathMru("/repo", "a.ts");
    expect(listFilesPathMru("/repo")).toEqual(["a.ts"]);
  });
});
