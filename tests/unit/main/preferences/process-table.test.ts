import { describe, expect, it } from "vitest";
import { collectDescendantPids } from "../../../../src/main/services/pier-resource/process-table.ts";

describe("collectDescendantPids", () => {
  it("walks children by ppid", () => {
    const processes = [
      {
        cpuPercent: 0,
        name: "root",
        pid: 1,
        ppid: 0,
        rssBytes: 1,
      },
      {
        cpuPercent: 0,
        name: "a",
        pid: 10,
        ppid: 1,
        rssBytes: 1,
      },
      {
        cpuPercent: 0,
        name: "b",
        pid: 11,
        ppid: 10,
        rssBytes: 1,
      },
      {
        cpuPercent: 0,
        name: "c",
        pid: 20,
        ppid: 1,
        rssBytes: 1,
      },
    ];
    expect(
      [...collectDescendantPids(10, processes)].sort((a, b) => a - b)
    ).toEqual([10, 11]);
    expect(collectDescendantPids(99, processes)).toEqual(new Set([99]));
  });
});
