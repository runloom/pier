import { describe, expect, it } from "vitest";
import {
  candidatePidsForEnvScan,
  collectSubtreePids,
} from "../../../../src/main/services/pier-resource/panel-env-scan.ts";
import type { ProcessTableRow } from "../../../../src/main/services/pier-resource/process-table.ts";

const processes: ProcessTableRow[] = [
  {
    cpuPercent: 0,
    name: "PierDev",
    pid: 100,
    ppid: 1,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "Electron Helper (Renderer)",
    pid: 101,
    ppid: 100,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "login",
    pid: 200,
    ppid: 100,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "-zsh",
    pid: 201,
    ppid: 200,
    rssBytes: 1,
  },
  {
    cpuPercent: 0.5,
    name: "node",
    pid: 202,
    ppid: 201,
    rssBytes: 1,
  },
  {
    cpuPercent: 0,
    name: "unrelated",
    pid: 999,
    ppid: 1,
    rssBytes: 1,
  },
];

describe("panel-env-scan candidates", () => {
  it("collects pier subtree and drops Electron helpers from env candidates", () => {
    expect(collectSubtreePids([100], processes).sort((a, b) => a - b)).toEqual([
      100, 101, 200, 201, 202,
    ]);
    expect(
      candidatePidsForEnvScan([100], processes).sort((a, b) => a - b)
    ).toEqual([200, 201, 202]);
  });
});
