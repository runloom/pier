import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexAccountsStateStore } from "../../../packages/plugin-codex/src/main/state.ts";

let dir = "";
let statePath = "";
let markerPath = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-codex-state-"));
  statePath = join(dir, "accounts.json");
  markerPath = join(dir, ".pier-plugin-data-schemas.json");
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("Codex accounts data schema", () => {
  it("validates metadata and atomically repairs a missing host marker", async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        accounts: [],
        activeAccountId: null,
        revision: 2,
        schemaVersion: 1,
      })
    );
    const store = createCodexAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).resolves.toMatchObject({ revision: 2 });
    expect(existsSync(markerPath)).toBe(false);
    await store.ensureSchemaMarker();
    expect(existsSync(markerPath)).toBe(true);
    await expect(readFile(markerPath, "utf8")).resolves.toBe(
      JSON.stringify({
        schemas: {
          "codex.accounts": {
            updatedByPluginVersion: "1.0.3",
            version: 1,
          },
        },
        version: 1,
      })
    );
  });

  it("fails closed for unsupported account schemas instead of resetting data", async () => {
    const unsupported = JSON.stringify({
      accounts: [],
      activeAccountId: null,
      revision: 9,
      schemaVersion: 2,
    });
    await writeFile(statePath, unsupported);
    const store = createCodexAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).rejects.toThrow();
    await expect(readFile(statePath, "utf8")).resolves.toBe(unsupported);
  });

  it("accepts optional subscriptionExpiresAt written by newer account metadata", async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        accounts: [
          {
            createdAt: 1,
            email: "user@example.com",
            id: "acc-1",
            planType: "plus",
            provider: "codex",
            subscriptionExpiresAt: 1_800_000_000_000,
            updatedAt: 2,
          },
        ],
        activeAccountId: "acc-1",
        revision: 3,
        schemaVersion: 1,
      })
    );
    const store = createCodexAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).resolves.toMatchObject({
      accounts: [
        {
          id: "acc-1",
          subscriptionExpiresAt: 1_800_000_000_000,
        },
      ],
      activeAccountId: "acc-1",
      revision: 3,
    });
  });

  it("fails closed when the host-readable schema marker is malformed", async () => {
    await writeFile(markerPath, '{"version":1,"schemas":{"unknown":{}}}');
    const store = createCodexAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).rejects.toThrow();
  });

  it("persists a mutation that arrives while an earlier flush is in flight", async () => {
    const store = createCodexAccountsStateStore(statePath, "1.0.3");
    await store.init();
    store.mutate((state) => ({ ...state, revision: 1 }));
    const firstFlush = store.flush();
    store.mutate((state) => ({ ...state, revision: 2 }));
    await firstFlush;

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    expect(persisted.revision).toBe(2);
  });
});
