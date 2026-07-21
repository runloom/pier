import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrokAccountsStateStore } from "../../../packages/plugin-grok/src/main/state.ts";

let dir = "";
let statePath = "";
let markerPath = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pier-grok-state-"));
  statePath = join(dir, "accounts.json");
  markerPath = join(dir, ".pier-plugin-data-schemas.json");
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("Grok accounts data schema", () => {
  it("quarantines unsupported account schemas and starts fresh without losing the original file", async () => {
    const unsupported = JSON.stringify({
      accounts: [],
      activeAccountId: null,
      revision: 9,
      schemaVersion: 2,
    });
    await writeFile(statePath, unsupported);
    const store = createGrokAccountsStateStore(statePath, "1.0.3");

    // A bad file must not brick activation forever: init falls back to
    // defaults while the original bytes are preserved in a quarantine file.
    await expect(store.init()).resolves.toMatchObject({
      accounts: [],
      revision: 0,
    });
    expect(existsSync(statePath)).toBe(false);
    const entries = await readdir(dir);
    const quarantined = entries.find((name) =>
      name.startsWith("accounts.json.corrupt-")
    );
    expect(quarantined).toBeTruthy();
    await expect(readFile(join(dir, quarantined ?? ""), "utf8")).resolves.toBe(
      unsupported
    );
  });

  it("repairs a dangling active account id instead of failing activation", async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        accounts: [],
        activeAccountId: "ghost",
        revision: 3,
        schemaVersion: 1,
      })
    );
    const store = createGrokAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).resolves.toMatchObject({
      activeAccountId: null,
    });
  });

  it("dedupes duplicate account ids on load", async () => {
    const record = {
      createdAt: 1,
      email: "user@example.com",
      id: "acc-1",
      kind: "oidc",
      provider: "grok",
      updatedAt: 2,
    };
    await writeFile(
      statePath,
      JSON.stringify({
        accounts: [record, record],
        activeAccountId: "acc-1",
        revision: 3,
        schemaVersion: 1,
      })
    );
    const store = createGrokAccountsStateStore(statePath, "1.0.3");

    const state = await store.init();
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe("acc-1");
  });

  it("quarantines a malformed host-readable schema marker instead of failing activation", async () => {
    await writeFile(markerPath, '{"version":1,"schemas":{"unknown":{}}}');
    const store = createGrokAccountsStateStore(statePath, "1.0.3");

    await expect(store.init()).resolves.toBeTruthy();
    // The bad marker is moved aside; ensureSchemaMarker rewrites a valid one.
    expect(existsSync(markerPath)).toBe(false);
    await store.ensureSchemaMarker();
    expect(existsSync(markerPath)).toBe(true);
  });

  it("persists a mutation that arrives while an earlier flush is in flight", async () => {
    const store = createGrokAccountsStateStore(statePath, "1.0.3");
    await store.init();
    store.mutate((state) => ({ ...state, revision: 1 }));
    const firstFlush = store.flush();
    store.mutate((state) => ({ ...state, revision: 2 }));
    await firstFlush;

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    expect(persisted.revision).toBe(2);
  });
});
