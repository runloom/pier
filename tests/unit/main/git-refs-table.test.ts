import {
  defaultBranchCandidates,
  fetchRefsTable,
  parseRefsTable,
  upstreamGoneFor,
} from "@main/services/git-refs-table.ts";
import { describe, expect, it } from "vitest";

/** 构造一行 for-each-ref 输出：refname、oid、upstream、track、symref 以 NUL 分隔。 */
function line(
  refname: string,
  oid: string,
  upstream = "",
  track = "",
  symref = ""
): string {
  return [refname, oid, upstream, track, symref].join("\0");
}

describe("parseRefsTable", () => {
  it("解析多行 NUL 分隔输出的全部字段，跳过空行", () => {
    const output = [
      line(
        "refs/heads/main",
        "oid-main",
        "refs/remotes/origin/main",
        "[ahead 1, behind 2]"
      ),
      "",
      line(
        "refs/heads/feature",
        "oid-feat",
        "refs/remotes/origin/feature",
        "[gone]"
      ),
      line(
        "refs/remotes/origin/HEAD",
        "oid-main",
        "",
        "",
        "refs/remotes/origin/main"
      ),
      line("refs/remotes/origin/main", "oid-main"),
    ].join("\n");

    const table = parseRefsTable(output);

    expect(table.entries).toEqual([
      {
        oid: "oid-main",
        refname: "refs/heads/main",
        symref: "",
        track: "[ahead 1, behind 2]",
        upstream: "refs/remotes/origin/main",
      },
      {
        oid: "oid-feat",
        refname: "refs/heads/feature",
        symref: "",
        track: "[gone]",
        upstream: "refs/remotes/origin/feature",
      },
      {
        oid: "oid-main",
        refname: "refs/remotes/origin/HEAD",
        symref: "refs/remotes/origin/main",
        track: "",
        upstream: "",
      },
      {
        oid: "oid-main",
        refname: "refs/remotes/origin/main",
        symref: "",
        track: "",
        upstream: "",
      },
    ]);
  });

  it("尾部字段缺失时补空串（不产生 undefined）", () => {
    const table = parseRefsTable("refs/heads/main\0oid-main");
    expect(table.entries).toEqual([
      {
        oid: "oid-main",
        refname: "refs/heads/main",
        symref: "",
        track: "",
        upstream: "",
      },
    ]);
  });

  it("signature：同输出稳定，异输出可区分（refs 变化检测的契约）", () => {
    const a = line("refs/heads/main", "oid-1");
    const b = line("refs/heads/main", "oid-2");
    expect(parseRefsTable(a).signature).toBe(parseRefsTable(a).signature);
    expect(parseRefsTable(a).signature).not.toBe(parseRefsTable(b).signature);
  });
});

describe("defaultBranchCandidates", () => {
  it("多远端都有 HEAD 时 origin 优先（即使 origin 排在后面）", () => {
    const table = parseRefsTable(
      [
        line("refs/heads/main", "oid-local-main"),
        line(
          "refs/remotes/upstream/HEAD",
          "oid-up-other",
          "",
          "",
          "refs/remotes/upstream/other"
        ),
        line("refs/remotes/upstream/other", "oid-up-other"),
        line(
          "refs/remotes/origin/HEAD",
          "oid-origin-main",
          "",
          "",
          "refs/remotes/origin/main"
        ),
        line("refs/remotes/origin/main", "oid-origin-main"),
      ].join("\n")
    );

    expect(defaultBranchCandidates(table)).toEqual({
      local: {
        branchName: "main",
        oid: "oid-local-main",
        refname: "refs/heads/main",
      },
      remote: {
        branchName: "main",
        oid: "oid-origin-main",
        refname: "refs/remotes/origin/main",
      },
    });
  });

  it("无 origin 时 fallback 到其他远端的 HEAD", () => {
    const table = parseRefsTable(
      [
        line(
          "refs/remotes/upstream/HEAD",
          "oid-up-main",
          "",
          "",
          "refs/remotes/upstream/main"
        ),
        line("refs/remotes/upstream/main", "oid-up-main"),
      ].join("\n")
    );

    const { local, remote } = defaultBranchCandidates(table);
    expect(remote).toEqual({
      branchName: "main",
      oid: "oid-up-main",
      refname: "refs/remotes/upstream/main",
    });
    // 无同名本地分支 → local null
    expect(local).toBe(null);
  });

  it("带斜杠的默认分支名完整保留（refs/remotes/<remote>/ 前缀后全部是分支名）", () => {
    const table = parseRefsTable(
      [
        line("refs/heads/release/1.x", "oid-local"),
        line(
          "refs/remotes/origin/HEAD",
          "oid-remote",
          "",
          "",
          "refs/remotes/origin/release/1.x"
        ),
        line("refs/remotes/origin/release/1.x", "oid-remote"),
      ].join("\n")
    );

    expect(defaultBranchCandidates(table)).toEqual({
      local: {
        branchName: "release/1.x",
        oid: "oid-local",
        refname: "refs/heads/release/1.x",
      },
      remote: {
        branchName: "release/1.x",
        oid: "oid-remote",
        refname: "refs/remotes/origin/release/1.x",
      },
    });
  });

  it("无任何远端 HEAD symref → 双 null", () => {
    const table = parseRefsTable(
      [
        line("refs/heads/main", "oid-main"),
        line("refs/remotes/origin/main", "oid-main"),
      ].join("\n")
    );
    expect(defaultBranchCandidates(table)).toEqual({
      local: null,
      remote: null,
    });
  });

  it("symref 指向的远端分支条目缺失（prune 后悬空）→ remote null，local 仍可命中", () => {
    const table = parseRefsTable(
      [
        line("refs/heads/main", "oid-local-main"),
        line(
          "refs/remotes/origin/HEAD",
          "",
          "",
          "",
          "refs/remotes/origin/main"
        ),
      ].join("\n")
    );
    expect(defaultBranchCandidates(table)).toEqual({
      local: {
        branchName: "main",
        oid: "oid-local-main",
        refname: "refs/heads/main",
      },
      remote: null,
    });
  });
});

describe("upstreamGoneFor", () => {
  const table = parseRefsTable(
    [
      line(
        "refs/heads/gone-branch",
        "oid-1",
        "refs/remotes/origin/x",
        "[gone]"
      ),
      line(
        "refs/heads/tracking",
        "oid-2",
        "refs/remotes/origin/tracking",
        "[ahead 2]"
      ),
      line("refs/heads/no-upstream", "oid-3"),
    ].join("\n")
  );

  it.each([
    { branch: "gone-branch", expected: true, name: "track 含 [gone] → true" },
    {
      branch: "tracking",
      expected: false,
      name: "有 upstream 未 gone → false",
    },
    { branch: "no-upstream", expected: false, name: "无 upstream → false" },
    {
      branch: "not-in-table",
      expected: false,
      name: "分支不在表内 → false",
    },
    { branch: null, expected: false, name: "detached（null）→ false" },
  ])("$name", ({ branch, expected }) => {
    expect(upstreamGoneFor(table, branch)).toBe(expected);
  });
});

describe("fetchRefsTable", () => {
  it("exec 失败（非 git 目录等）→ null", async () => {
    const exec = () => Promise.reject(new Error("not a git repository"));
    expect(await fetchRefsTable(exec, "/not-a-repo")).toBe(null);
  });
});
