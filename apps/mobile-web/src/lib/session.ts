/**
 * Web 壳会话装配：帧客户端单例 + 连接/watch 生命周期 + 快照按需刷新。
 * - connection 状态经 onStatusChange 镜像进 zustand store；
 * - control.watch 快照事件整帧替换进 store；
 * - refreshSnapshot 走 control.snapshot request（服务端 authorizer 白名单 op）。
 */
import { controlSnapshotPayloadSchema } from "@shared/contracts/local-control/control-snapshot.ts";
import { PierMobileClient } from "./client.ts";
import {
  canReachViaRelay,
  loadHosts,
  type StoredHost,
  storedHostKey,
} from "./paired-hosts.ts";
import { createRelayWebSocketFactory } from "./relay-transport.ts";
import { useMobileWebStore } from "./store.ts";

let client: PierMobileClient | null = null;
/** 当前已连接（或连接中）的宿主键；null = 未选择。 */
let activeKey: string | null = null;
/** 当前目标宿主全量记录：回前台恢复重拨用（§9.1）。 */
let activeHost: StoredHost | null = null;

export function getMobileClient(): PierMobileClient {
  if (client === null) {
    client = new PierMobileClient({
      onStatusChange: (status) => {
        useMobileWebStore.getState().setConnection(status);
      },
    });
  }
  return client;
}

export function activeHostKey(): string | null {
  return activeKey;
}

/** 连接目标宿主并开始 watch（幂等：同机已连接直接复用；换机先 close）。 */
export async function connectHost(target: StoredHost): Promise<void> {
  const c = getMobileClient();
  const key = storedHostKey(target);
  if (activeKey === key && c.status === "connected") {
    return;
  }
  if (activeKey !== null && activeKey !== key) {
    c.close();
  }
  activeKey = key;
  activeHost = target;
  // relay 三要素齐备 → 经会合密封通道（跨网）；否则 dev direct ws://（同网）。
  const transportFactory = canReachViaRelay(target)
    ? createRelayWebSocketFactory({
        deviceId: target.deviceId,
        deviceToken: target.deviceToken,
        fingerprint: target.fingerprint,
        hostId: target.hostId,
        relayUrl: target.relayUrl,
      })
    : undefined;
  await c.connect({
    deviceId: target.deviceId,
    deviceToken: target.deviceToken,
    host: target.host,
    port: target.port,
    ...(transportFactory ? { transportFactory } : {}),
  });
  c.watch(
    (payload) => {
      useMobileWebStore.getState().applySnapshot(payload);
    },
    // 断线由重连机制自愈；致命错误已镜像进 connection 状态，这里不再上抛
    () => {}
  ).catch(() => {});
}
/** 启动时静默回连最近配对的宿主；失败不打扰用户（H1 列表可见状态）。 */
export async function autoConnectLatestHost(): Promise<void> {
  const latest = loadHosts()[0];
  if (latest === undefined) {
    return;
  }
  await connectHost(latest);
}

/**
 * 回前台恢复（§9.1「回到前台拉最新快照」）：iOS 后台冻结定时器，
 * 重连退避可能停摆——回前台时已连接则立刻拉全量快照补帧；断线中则
 * 立即重拨（connect 重入会取消挂起的退避定时器）。closed（令牌吊销/
 * 用户关闭）不自动复活，横幅引导重新配对。
 */
export async function resumeActiveHost(): Promise<void> {
  const target = activeHost;
  const c = getMobileClient();
  if (target === null || c.status === "closed" || c.status === "idle") {
    return;
  }
  if (c.status === "connected") {
    await refreshSnapshot();
    return;
  }
  await connectHost(target);
}

/** 按需全量快照刷新（interaction_stale 等场景）。 */
export async function refreshSnapshot(): Promise<void> {
  const c = getMobileClient();
  if (c.status !== "connected") {
    throw new Error("not connected");
  }
  const payload = controlSnapshotPayloadSchema.parse(
    await c.request<unknown>("control.snapshot")
  );
  useMobileWebStore.getState().applySnapshot(payload);
}
