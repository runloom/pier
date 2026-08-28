import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteMemoryObservation,
  parseMemoryItems,
  readMemoryList,
} from "@main/services/agent-managed-assets/jsonl.ts";
import { describe, expect, it } from "vitest";

const lines = [
  JSON.stringify({
    entityType: "convention",
    name: "pnpm",
    observations: ["use pnpm", "lockfile committed"],
    type: "entity",
  }),
  JSON.stringify({
    from: "pnpm",
    to: "node",
    type: "relation",
  }),
  JSON.stringify({
    entityType: "note",
    name: "skip",
    observations: ["hidden"],
    type: "entity",
  }),
].join("\n");

describe("memory jsonl", () => {
  it("lists only four entityTypes and skips relations", () => {
    const items = parseMemoryItems(lines);
    expect(items.map((row) => row.observation)).toEqual([
      "use pnpm",
      "lockfile committed",
    ]);
    expect(items[0]).toMatchObject({
      entityName: "pnpm",
      entityType: "convention",
      index: 0,
    });
    expect(items[1]?.index).toBe(1);
  });

  it("deletes by entityName, index and matching text", () => {
    const result = deleteMemoryObservation(lines, "pnpm", 0, "use pnpm");
    if ("error" in result) {
      throw new Error("expected next");
    }
    const items = parseMemoryItems(result.next);
    expect(items.map((row) => row.observation)).toEqual(["lockfile committed"]);
    expect(items[0]?.index).toBe(0);
  });

  it("returns not-found for bad index", () => {
    expect(deleteMemoryObservation(lines, "pnpm", 9, "use pnpm")).toEqual({
      error: "not-found",
    });
  });

  it("refuses to delete when the stored text no longer matches", () => {
    expect(deleteMemoryObservation(lines, "pnpm", 0, "stale text")).toEqual({
      error: "not-found",
    });
  });

  it("cascades relations when the last observation removes the entity", () => {
    const single = [
      JSON.stringify({
        entityType: "decision",
        name: "dockview",
        observations: ["layout uses dockview"],
        type: "entity",
      }),
      JSON.stringify({ from: "dockview", to: "react", type: "relation" }),
      JSON.stringify({ from: "react", to: "dockview", type: "relation" }),
      JSON.stringify({ from: "pnpm", to: "node", type: "relation" }),
    ].join("\n");
    const result = deleteMemoryObservation(
      single,
      "dockview",
      0,
      "layout uses dockview"
    );
    if ("error" in result) {
      throw new Error("expected next");
    }
    const rows = result.next
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { from?: string; to?: string });
    // 实体行与其两条关联边都被清掉;无关的 relation 保留。
    expect(rows).toEqual([{ from: "pnpm", to: "node", type: "relation" }]);
  });

  it("marks tooLarge when file exceeds cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pier-mem-jsonl-"));
    const path = join(dir, "memory.jsonl");
    writeFileSync(path, "x".repeat(8 * 1024 * 1024 + 1));
    await expect(readMemoryList(path)).resolves.toEqual({
      items: [],
      tooLarge: true,
    });
  });
});
