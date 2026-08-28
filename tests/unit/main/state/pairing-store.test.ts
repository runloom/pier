import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPairingStore,
  DEFAULT_PAIRING_STATE,
} from "@main/state/pairing-store.ts";
import type { PierPairedDevice } from "@shared/contracts/remote.ts";
import { afterEach, describe, expect, it } from "vitest";

const INSTANCE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const tempDirs: string[] = [];

async function pairingFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-pairing-store-"));
  tempDirs.push(dir);
  return join(dir, "pairing.json");
}

async function readStored(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf-8")) as Record<
    string,
    unknown
  >;
}

function makeDevice(
  overrides: Partial<PierPairedDevice> = {}
): PierPairedDevice {
  return {
    capabilities: ["remote-access:read", "notification:write"],
    createdAt: 1,
    deviceId: "dev-1",
    lastSeenAt: 2,
    name: "phone",
    shell: "web",
    tokenEpoch: 1,
    tokenHash: "hash-1",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("pairing store", () => {
  it("returns defaults and generates an instanceSecret on first init", async () => {
    const filePath = await pairingFile();

    const store = createPairingStore(filePath);
    const state = await store.init();

    expect(state.devices).toEqual(DEFAULT_PAIRING_STATE.devices);
    expect(state.pendingPairing).toBe(DEFAULT_PAIRING_STATE.pendingPairing);
    expect(state.instanceSecret).toMatch(INSTANCE_SECRET_PATTERN);

    // 生成的 instanceSecret 必须随 init 落盘。
    const onDisk = await readStored(filePath);
    expect(onDisk.instanceSecret).toBe(state.instanceSecret);
  });

  it("persists device add and remove across store instances", async () => {
    const filePath = await pairingFile();
    const device = makeDevice();

    const store = createPairingStore(filePath);
    await store.init();
    store.mutate((state) => ({
      ...state,
      devices: [...state.devices, device],
    }));
    store.mutate((state) => ({
      ...state,
      pendingPairing: { codeHash: "code-hash", expiresAt: 123 },
    }));
    await store.flush();

    const reopened = createPairingStore(filePath);
    const loaded = await reopened.init();
    expect(loaded.devices).toEqual([device]);
    expect(loaded.pendingPairing).toEqual({
      codeHash: "code-hash",
      expiresAt: 123,
    });

    reopened.mutate((state) => ({
      ...state,
      devices: state.devices.filter((d) => d.deviceId !== device.deviceId),
      pendingPairing: null,
    }));
    await reopened.flush();

    const again = createPairingStore(filePath);
    const reloaded = await again.init();
    expect(reloaded.devices).toEqual([]);
    expect(reloaded.pendingPairing).toBeNull();
  });

  it("reuses the persisted instanceSecret instead of regenerating it", async () => {
    const filePath = await pairingFile();

    const first = createPairingStore(filePath);
    const firstSecret = (await first.init()).instanceSecret;
    await first.flush();

    const second = createPairingStore(filePath);
    const secondSecret = (await second.init()).instanceSecret;
    expect(secondSecret).toBe(firstSecret);
  });

  it("falls back to defaults when the file is not JSON", async () => {
    const filePath = await pairingFile();
    await writeFile(filePath, "{not json");

    const store = createPairingStore(filePath);
    const state = await store.init();

    expect(state.devices).toEqual(DEFAULT_PAIRING_STATE.devices);
    expect(state.pendingPairing).toBe(DEFAULT_PAIRING_STATE.pendingPairing);
    expect(state.instanceSecret).toMatch(INSTANCE_SECRET_PATTERN);

    await store.flush();
    const onDisk = await readStored(filePath);
    expect(onDisk.devices).toEqual([]);
    expect(onDisk.pendingPairing).toBeNull();
  });

  it("falls back to defaults when the file fails schema validation", async () => {
    const filePath = await pairingFile();
    await writeFile(
      filePath,
      JSON.stringify({
        devices: "not-an-array",
        instanceSecret: 42,
        pendingPairing: "nope",
      })
    );

    const store = createPairingStore(filePath);
    const state = await store.init();

    expect(state.devices).toEqual(DEFAULT_PAIRING_STATE.devices);
    expect(state.pendingPairing).toBe(DEFAULT_PAIRING_STATE.pendingPairing);
    expect(state.instanceSecret).toMatch(INSTANCE_SECRET_PATTERN);

    await store.flush();
    const onDisk = await readStored(filePath);
    expect(onDisk.devices).toEqual([]);
  });
});
