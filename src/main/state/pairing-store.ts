/**
 * 配对持久化：已配对设备、一次性配对占位与实例密钥。
 *
 * 磁盘文件 userData/pairing.json，令牌原文永不出内存——devices 里只存
 * tokenHash。instanceSecret 首次 init 生成（32 字节 base64url）并落盘，
 * fingerprint = sha256 前 16 hex 由服务层派生。schema 演进只许 additive
 * 可选字段（M2 加 accountId? 等归属字段），zod 解析向后兼容。
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import type { PierPairedDevice } from "@shared/contracts/remote.ts";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

export interface PairingState {
  devices: PierPairedDevice[];
  instanceSecret: string;
  pendingPairing: { codeHash: string; expiresAt: number } | null;
}

/** 磁盘 schema：本地镜像 PierPairedDevice 形状（remote.ts 保持纯 TS interface）。 */
const pairedDeviceSchema = z.object({
  capabilities: z.array(pierCapabilitySchema),
  createdAt: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  lastSeenAt: z.number().int().nonnegative(),
  name: z.string().min(1),
  shell: z.enum(["app", "miniprogram", "web"]),
  tokenEpoch: z.number().int().nonnegative(),
  tokenHash: z.string().min(1),
});

const pairingStateSchema = z.object({
  devices: z.array(pairedDeviceSchema),
  instanceSecret: z.string(),
  pendingPairing: z
    .object({
      codeHash: z.string().min(1),
      expiresAt: z.number(),
    })
    .nullable(),
});

/** 编译期镜像校验：schema 推断形状必须等于 PairingState。 */
const pairingStateSchemaCheck =
  pairingStateSchema satisfies z.ZodType<PairingState>;
export type _PairingStateSchema = typeof pairingStateSchemaCheck;

export const DEFAULT_PAIRING_STATE: PairingState = {
  devices: [],
  instanceSecret: "",
  pendingPairing: null,
};

export interface PairingStore {
  clear(): Promise<void>;
  flush(): Promise<void>;
  get(): PairingState;
  init(): Promise<PairingState>;
  mutate(fn: (state: PairingState) => PairingState): PairingState;
}

function generateInstanceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function createPairingStore(filePath: string): PairingStore {
  const store: DebouncedJsonStore<PairingState> =
    debouncedJsonStore<PairingState>({
      defaults: DEFAULT_PAIRING_STATE,
      debounceMs: 500,
      filePath,
    });
  let ensurePromise: Promise<PairingState> | null = null;

  async function ensure(): Promise<PairingState> {
    const raw = await store.init();
    let parsed: PairingState;
    try {
      parsed = pairingStateSchema.parse(raw);
    } catch (err) {
      console.warn("[pairing-store] parse failed, resetting to defaults:", err);
      await store.clear();
      parsed = pairingStateSchema.parse(await store.init());
    }
    if (!parsed.instanceSecret) {
      parsed = { ...parsed, instanceSecret: generateInstanceSecret() };
      store.replace(parsed);
      // 密钥必须先落盘再向外可见，崩溃重启后 fingerprint 才稳定。
      await store.flush();
    } else if (JSON.stringify(parsed) !== JSON.stringify(raw)) {
      store.replace(parsed);
    }
    return parsed;
  }

  function init(): Promise<PairingState> {
    if (!ensurePromise) {
      ensurePromise = ensure().finally(() => {
        ensurePromise = null;
      });
    }
    return ensurePromise;
  }

  return {
    clear: () => store.clear(),
    flush: () => store.flush(),
    get: () => store.get(),
    init,
    mutate: (fn) => store.mutate(fn),
  };
}

function resolveFilePath(): string {
  return join(app.getPath("userData"), "pairing.json");
}

let singleton: PairingStore | undefined;

function getStore(): PairingStore {
  if (!singleton) {
    singleton = createPairingStore(resolveFilePath());
  }
  return singleton;
}

/**
 * app-core 装配（Task 13）与 flushPairingState 共用同一 store 实例：
 * 若各自 createPairingStore 会得到互盲的双实例，quit flush 落空。
 */
export function getSharedPairingStore(): PairingStore {
  return getStore();
}

export async function readPairingState(): Promise<PairingState> {
  const store = getStore();
  await store.init();
  return store.get();
}

export async function updatePairingState(
  recipe: (state: PairingState) => PairingState
): Promise<PairingState> {
  const store = getStore();
  await store.init();
  return store.mutate(recipe);
}

export async function flushPairingState(): Promise<void> {
  const store = getStore();
  await store.init();
  await store.flush();
}
