import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "@main/services/agent-managed-assets/ledger.ts";
import { buildServerEntry } from "@main/services/agent-managed-assets/serializers.ts";
import { applyMemoryTarget } from "@main/services/agent-managed-assets/target.ts";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("applyMemoryTarget enable WAL", () => {
  it("persists pending before writing the target file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-mem-target-"));
    dirs.push(dir);
    const ledgerDir = join(dir, "ledger");
    const abs = join(dir, ".mcp.json");
    const ledgerStore = new LedgerStore({
      canonicalRoot: dir,
      dir: ledgerDir,
    });
    const ledger = await ledgerStore.load();
    let savedPendingBeforeWrite = false;
    const save = async () => {
      savedPendingBeforeWrite =
        !existsSync(abs) &&
        ledger.pending.some(
          (item) => item.action === "write" && item.targetPath === abs
        );
      await ledgerStore.save(ledger);
    };
    await applyMemoryTarget({
      abs,
      book: ledger,
      consumers: ["claude"],
      desired: "enabled",
      entry: buildServerEntry(join(dir, "memory.jsonl")),
      format: "mcp-servers-json",
      save,
    });
    expect(savedPendingBeforeWrite).toBe(true);
    expect(existsSync(abs)).toBe(true);
  });
});
