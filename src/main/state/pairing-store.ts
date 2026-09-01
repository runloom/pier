/**
 * 配对持久化：已配对设备、一次性配对占位、实例密钥与宿主身份公钥。
 *
 * 磁盘文件 userData/pairing.json，令牌原文永不出内存——devices 里只存
 * tokenHash（M2 起另存 relayPassHash：会合准入通行证哈希，服务端设计 §4）。
 * instanceSecret 为 M1 遗留（M2 指纹改由宿主身份公钥派生，字段只读兼容、
 * 不再消费）。schema 演进只许 additive 可选字段（M2 已加 relayPassHash /
 * hostKey；未来账号层才加 accountId? 等归属字段），zod 解析向后兼容。
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import {
  type PierPairedDevice,
  type PierPushHandle,
  pierPushHandleSchema,
} from "@shared/contracts/remote.ts";
import { app } from "electron";
import { z } from "zod";
import {
  type DebouncedJsonStore,
  debouncedJsonStore,
} from "./debounced-store.ts";

/** 磁盘扩展形状：契约字段 + 宿主内部的会合通行证哈希（不出网，见 remote-access 脱敏）。 */
export interface StoredPairedDevice extends PierPairedDevice {
  relayPassHash?: string | undefined;
}

export interface PairingState {
  devices: StoredPairedDevice[];
  /** M2 宿主身份（Ed25519 公钥原始字节 base64url）；私钥在 secrets-store。 */
  hostKey?: { publicKeyRaw: string } | null | undefined;
  instanceSecret: string;
  /**
   * M2 发布动作已执行标记（规格 §9 第 6 条）：首次就绪时一次性删除
   * LAN 切片存量设备记录（等价吊销）。缺省 = 尚未清扫。
   */
  lanTokenSweepAt?: number | undefined;
  pendingPairing: { codeHash: string; expiresAt: number } | null;
  /** M2 推送句柄（规格 §12：订阅记录按 deviceId 落盘在宿主）。 */
  pushHandles?: PierPushHandle[] | undefined;
  /** 远程访问开关（用户显式开启过 → 重启自动恢复监听与会合拨号）。 */
  remoteAccessEnabled?: boolean | undefined;
}

/** 磁盘 schema：本地镜像 PierPairedDevice 形状（remote.ts 保持纯 TS interface）。 */
const pairedDeviceSchema = z.object({
  capabilities: z.array(pierCapabilitySchema),
  createdAt: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
  lastSeenAt: z.number().int().nonnegative(),
  name: z.string().min(1),
  relayPassHash: z.string().min(1).optional(),
  shell: z.enum(["app", "miniprogram", "web"]),
  tokenEpoch: z.number().int().nonnegative(),
  tokenHash: z.string().min(1),
});

const pairingStateSchema = z.object({
  devices: z.array(pairedDeviceSchema),
  hostKey: z
    .object({ publicKeyRaw: z.string().min(1) })
    .nullable()
    .optional(),
  instanceSecret: z.string(),
  lanTokenSweepAt: z.number().int().nonnegative().optional(),
  pendingPairing: z
    .object({
      codeHash: z.string().min(1),
      expiresAt: z.number(),
    })
    .nullable(),
  pushHandles: z.array(pierPushHandleSchema).optional(),
  remoteAccessEnabled: z.boolean().optional(),
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
    // M2 发布动作（规格 §9 第 6 条）：磁盘态无清扫标记 = 切片期存量，
    // 一次性删除设备记录（等价吊销：tokenHash 随记录消失，重连即
    // auth_failed）。init 之后新配对的设备写在标记之后，永不受影响。
    // 仅递增 tokenEpoch 只断会话、不作废令牌原文，达不到本条目的。
    if (parsed.lanTokenSweepAt === undefined) {
      if (parsed.devices.length > 0) {
        console.warn(
          `[pairing-store] M2 sweep: revoking ${parsed.devices.length} pre-M2 paired device(s); re-pair from the official origin`
        );
      }
      parsed = {
        ...parsed,
        devices: [],
        lanTokenSweepAt: Date.now(),
        pushHandles: [],
      };
    }
    if (!parsed.instanceSecret) {
      parsed = { ...parsed, instanceSecret: generateInstanceSecret() };
      store.replace(parsed);
      // 密钥必须先落盘再向外可见，崩溃重启后 fingerprint 才稳定。
      await store.flush();
    } else if (JSON.stringify(parsed) !== JSON.stringify(raw)) {
      store.replace(parsed);
      // 清扫标记必须落盘：崩溃重启不得重复吊销新配对的设备。
      await store.flush();
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
  if (singleton === undefined) {
    return;
  }
  // 未 init 则无脏数据；quit 不得为生成 instanceSecret 写盘。
  await singleton.flush();
}
