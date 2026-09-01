/**
 * 会合 HTTP 客户端（M2 Task 9）：批量在线态查询与密封赎回。
 * relayPass 每次从存储的 deviceToken 即时派生，不落盘（服务端设计 §5.2/§5.3）。
 */
import type {
  HostsStatusResponse,
  RelaySealedFrame,
} from "@shared/contracts/relay/index.ts";
import {
  derivePairKey,
  deriveRelayPass,
  sealFrame,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";

export interface RelayStatusQuery {
  deviceId: string;
  deviceToken: string;
  fingerprint: string;
  hostId: string;
}

/** QR / 存储里是 wss 基址；浏览器 fetch 只能走 https/http。 */
export function httpBaseFromRelayUrl(relayUrl: string): string {
  const trimmed = relayUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice("wss://".length)}`;
  }
  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice("ws://".length)}`;
  }
  return trimmed;
}

/**
 * POST /hosts/status：返回 hostId → online 映射。查询失败（网络 / 非 200）
 * 返回 null——调用方必须把「查不到状态」与「宿主离线」区分展示，不得把
 * 会合不可用伪装成整排电脑离线。空查询恒空 Map。
 */
export async function fetchHostsStatus(
  relayUrl: string,
  queries: RelayStatusQuery[],
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, boolean> | null> {
  if (queries.length === 0) {
    return new Map();
  }
  const body = await Promise.all(
    queries.map(async (query) => ({
      deviceId: query.deviceId,
      hostId: query.hostId,
      relayPass: await deriveRelayPass({
        deviceToken: query.deviceToken,
        fingerprint: query.fingerprint,
      }),
    }))
  );
  try {
    const response = await fetchImpl(
      `${httpBaseFromRelayUrl(relayUrl)}/hosts/status`,
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    if (!response.ok) {
      return null;
    }
    const parsed = (await response.json()) as HostsStatusResponse;
    return new Map(parsed.map((entry) => [entry.hostId, entry.online]));
  } catch {
    return null;
  }
}

export interface RelayRedeemArgs {
  fingerprint: string;
  hostId: string;
  pairSecret: string;
  relayUrl: string;
  request: {
    code: string;
    requestedCapabilities: string[];
    shell: "web";
    name?: string;
  };
}

export type RelayRedeemResult =
  | {
      ok: true;
      deviceId: string;
      deviceToken: string;
      grantedCapabilities: string[];
      tokenEpoch: number;
    }
  | { ok: false; reason: string };

/** 密封赎回（服务端设计 §5.3）：pairKey 密封请求 → 解封结果，relay 只见密文。 */
export async function redeemViaRelay(
  args: RelayRedeemArgs,
  fetchImpl: typeof fetch = fetch
): Promise<RelayRedeemResult> {
  const pairKey = await derivePairKey({
    fingerprint: args.fingerprint,
    pairSecret: args.pairSecret,
  });
  const sealed = await sealFrame(pairKey, 0, JSON.stringify(args.request));
  let response: Response;
  try {
    response = await fetchImpl(
      `${httpBaseFromRelayUrl(args.relayUrl)}/pair/relay`,
      {
        body: JSON.stringify({ hostId: args.hostId, sealed }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
  } catch {
    return { ok: false, reason: "network_error" };
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      reason?: string;
    };
    return { ok: false, reason: failure.reason ?? "relay_error" };
  }
  const { sealed: sealedResult } = (await response.json()) as {
    sealed: RelaySealedFrame;
  };
  let payloadJson: string;
  try {
    payloadJson = await unsealFrame(pairKey, sealedResult, -1);
  } catch {
    return { ok: false, reason: "seal_error" };
  }
  const payload = JSON.parse(payloadJson) as
    | {
        deviceId: string;
        deviceToken: string;
        grantedCapabilities: string[];
        tokenEpoch: number;
      }
    | { reason: string };
  if ("reason" in payload) {
    return { ok: false, reason: payload.reason };
  }
  return { ok: true, ...payload };
}
