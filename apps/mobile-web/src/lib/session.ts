/**
 * Web 壳会话装配：帧客户端单例 + 连接/watch 生命周期 + 快照按需刷新。
 * - connection 状态经 onStatusChange 镜像进 zustand store；
 * - control.watch 快照事件整帧替换进 store；
 * - refreshSnapshot 走 control.snapshot request（服务端 authorizer 白名单 op）。
 */
import { controlSnapshotPayloadSchema } from "@shared/contracts/local-control/control-snapshot.ts";
import { PierMobileClient } from "./client.ts";
import { hostKey, loadHosts, type StoredHost } from "./paired-hosts.ts";
import { useMobileWebStore } from "./store.ts";

let client: PierMobileClient | null = null;
/** 当前已连接（或连接中）的宿主键；null = 未选择。 */
let activeKey: string | null = null;

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
  const key = hostKey(target.host, target.port);
  if (activeKey === key && c.status === "connected") {
    return;
  }
  if (activeKey !== null && activeKey !== key) {
    c.close();
  }
  activeKey = key;
  await c.connect({
    deviceId: target.deviceId,
    deviceToken: target.deviceToken,
    host: target.host,
    port: target.port,
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
