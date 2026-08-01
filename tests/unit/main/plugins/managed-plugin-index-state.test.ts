import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedPluginIndexStore } from "@main/services/managed-plugins/index-state.ts";
import { afterEach, describe, expect, it } from "vitest";

let dir = "";

afterEach(async () => {
  if (dir) await rm(dir, { force: true, recursive: true });
});

describe("managed plugin index state", () => {
  it("backs up and fails closed without overwriting an invalid index", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-managed-index-"));
    const filePath = join(dir, "index.json");
    const invalid = '{"version":1,"plugins":{"pier.codex":{"enabled":true}}}';
    await writeFile(filePath, invalid);

    const store = createManagedPluginIndexStore(filePath);
    await expect(store.init()).rejects.toThrow("schema validation failed");
    await expect(readFile(filePath, "utf8")).resolves.toBe(invalid);
    await expect(readFile(`${filePath}.invalid-backup`, "utf8")).resolves.toBe(
      invalid
    );
  });

  it("backs up and fails closed for malformed JSON", async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-managed-index-json-"));
    const filePath = join(dir, "index.json");
    const malformed = '{"version":1,"plugins":';
    await writeFile(filePath, malformed);

    await expect(
      createManagedPluginIndexStore(filePath).init()
    ).rejects.toThrow("JSON is invalid");
    await expect(readFile(filePath, "utf8")).resolves.toBe(malformed);
    await expect(readFile(`${filePath}.invalid-backup`, "utf8")).resolves.toBe(
      malformed
    );
  });
});
