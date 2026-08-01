import { describe, expect, it } from "vitest";
import type { ProcessTableRow } from "../../../../src/main/services/pier-resource/process-table.ts";
import {
  pickPreferredResolvedRoot,
  resolveRootFromPid,
} from "../../../../src/main/services/pier-resource/resolve-session-roots.ts";

const processes: ProcessTableRow[] = [
  {
    cpuPercent: 0,
    name: "PierDev",
    pid: 1,
    ppid: 0,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "login",
    pid: 10,
    ppid: 1,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "zsh",
    pid: 20,
    ppid: 10,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "zsh",
    pid: 30,
    ppid: 20,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "node",
    pid: 40,
    ppid: 30,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "-claude",
    pid: 50,
    ppid: 10,
    rssBytes: 1,
  },
];

describe("resolveRootFromPid", () => {
  it("pins root to login even from nested shell descendants", () => {
    const resolved = resolveRootFromPid(40, processes);
    expect(resolved.loginPid).toBe(10);
    expect(resolved.rootPid).toBe(10);
    expect(resolved.shellPid).toBe(20);
  });

  it("pins root to login from sibling agent under login", () => {
    const resolved = resolveRootFromPid(50, processes);
    expect(resolved.loginPid).toBe(10);
    expect(resolved.rootPid).toBe(10);
  });
});

describe("pickPreferredResolvedRoot", () => {
  it("prefers a root that found login", () => {
    const preferred = pickPreferredResolvedRoot([
      { loginPid: null, rootPid: 30, shellPid: 30 },
      { loginPid: 10, rootPid: 10, shellPid: 20 },
    ]);
    expect(preferred?.rootPid).toBe(10);
  });
});
