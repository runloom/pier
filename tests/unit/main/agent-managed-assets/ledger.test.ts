import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LedgerPending,
  LedgerStore,
} from "@main/services/agent-managed-assets/ledger.ts";
import { afterEach, describe, expect, it } from "vitest";

let dir = "";

afterEach(async () => {
  if (dir) {
    await rm(dir, { force: true, recursive: true });
  }
  dir = "";
});

function pending(prior: string, expected: string): LedgerPending {
  return {
    action: "write",
    commitRecord: {
      existedBefore: true,
      fingerprint: expected,
      lastOutcome: "written",
    },
    expectedFingerprint: expected,
    kind: "mcp-target",
    priorFingerprint: prior,
    targetPath: "/p/.mcp.json",
  };
}

describe("LedgerStore", () => {
  it("creates defaults then persists mutations round-trip", async () => {
    dir = mkdtempSync(join(tmpdir(), "pier-mem-ledger-"));
    const store = new LedgerStore({ canonicalRoot: "/repo", dir });
    const ledger = await store.load();
    expect(ledger.desiredState).toBe("disabled");
    expect(ledger.pending).toEqual([]);
    ledger.desiredState = "enabled";
    await store.save(ledger);
    const reloaded = await new LedgerStore({
      canonicalRoot: "/repo",
      dir,
    }).load();
    expect(reloaded.desiredState).toBe("enabled");
    const raw = await readFile(join(dir, "ledger.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("recover branch 1 commits when reality matches expectation", () => {
    const item = pending("absent", "ff");
    expect(LedgerStore.recover(item, "ff")).toEqual({
      branch: 1,
      commit: item.commitRecord,
    });
  });

  it("recover branch 2 replays when nothing happened yet", () => {
    expect(LedgerStore.recover(pending("aa", "ff"), "aa")).toEqual({
      branch: 2,
    });
  });

  it("recover branch 3 reports conflict on third-party drift", () => {
    expect(LedgerStore.recover(pending("aa", "ff"), "zz")).toEqual({
      branch: 3,
    });
  });
});
