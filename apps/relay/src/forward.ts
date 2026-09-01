/**
 * envelope 盲转发中枢（服务端设计 §5/§7）：
 * - uplink：挑战签名准入 → 名册担保 → 双向透传 / 名册增删 / 赎回应答；
 * - downlink：通行证准入 → 载体联合直发透传；
 * - 治理红线：本文件对 `frame` 载体只做结构校验与原样搬运，
 *   不解密、不读密文内容、不引入密封层实现（服务端设计 §13）。
 *
 * 信息泄露纪律：downlink 握手一切失败（宿主离线 / 名册不符）统一答
 * `host_offline`——无有效通行证者探测不到任何 hostId 的存在性与在线态。
 */
import { randomBytes, randomUUID } from "node:crypto";
import type {
  RelayErrorCode,
  RelaySealedFrame,
} from "@shared/contracts/relay/index.ts";
import {
  downlinkClientFrameSchema,
  relayEnvelopeFrameSchema,
  uplinkClientFrameSchema,
} from "@shared/contracts/relay/index.ts";
import type { WebSocket } from "ws";
import type { RelayConfig } from "./config.ts";
import { verifyUplinkHello } from "./host-auth.ts";
import {
  createSlidingWindowLimiter,
  type SlidingWindowLimiter,
} from "./limits.ts";
import type { RelayRegistry, UplinkPort } from "./registry.ts";

const HELLO_TIMEOUT_MS = 10_000;

export type RedeemOutcome =
  | { kind: "result"; ok: boolean; sealedResult: RelaySealedFrame }
  | { kind: "failure"; reason: "host_offline" | "timeout" };

export interface RelayHub {
  attachDownlink(socket: WebSocket, remoteAddress: string): void;
  attachUplink(socket: WebSocket, remoteAddress: string): void;
  redeem(hostId: string, sealed: RelaySealedFrame): Promise<RedeemOutcome>;
}

export type RelayLogger = (
  event: string,
  fields?: Record<string, string | number | boolean>
) => void;

function sendError(
  socket: WebSocket,
  code: RelayErrorCode,
  message?: string
): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "server.error", code, message }));
  }
}

export function createRelayHub(args: {
  registry: RelayRegistry;
  config: RelayConfig;
  log?: RelayLogger;
}): RelayHub {
  const { registry, config } = args;
  const log: RelayLogger = args.log ?? (() => undefined);

  const uplinkHelloFailures = createSlidingWindowLimiter({
    limit: config.helloFailuresPerMinute,
    windowMs: 60_000,
  });
  const downlinkHelloFailures = createSlidingWindowLimiter({
    limit: config.helloFailuresPerMinute,
    windowMs: 60_000,
  });
  const downlinkHellos = createSlidingWindowLimiter({
    limit: config.downlinkHellosPerMinute,
    windowMs: 60_000,
  });
  const frameRate: SlidingWindowLimiter = createSlidingWindowLimiter({
    limit: config.framesPerSecond,
    windowMs: 1000,
  });

  /** hostId → deviceId → 活跃 downlink 管道。 */
  const pipes = new Map<string, Map<string, Set<WebSocket>>>();
  const pendingPairs = new Map<
    string,
    { settle: (outcome: RedeemOutcome) => void; timer: NodeJS.Timeout }
  >();
  let connSeq = 0;

  function pipesOf(hostId: string, deviceId: string): Set<WebSocket> {
    let byDevice = pipes.get(hostId);
    if (!byDevice) {
      byDevice = new Map();
      pipes.set(hostId, byDevice);
    }
    let set = byDevice.get(deviceId);
    if (!set) {
      set = new Set();
      byDevice.set(deviceId, set);
    }
    return set;
  }

  function closeDevicePipes(
    hostId: string,
    deviceId: string,
    code: RelayErrorCode
  ): void {
    const set = pipes.get(hostId)?.get(deviceId);
    if (!set) {
      return;
    }
    for (const socket of set) {
      sendError(socket, code);
      socket.close();
    }
    pipes.get(hostId)?.delete(deviceId);
  }

  function closeHostPipes(hostId: string, code: RelayErrorCode): void {
    const byDevice = pipes.get(hostId);
    if (!byDevice) {
      return;
    }
    for (const deviceId of [...byDevice.keys()]) {
      closeDevicePipes(hostId, deviceId, code);
    }
    pipes.delete(hostId);
  }

  function notifyDownlinkGone(hostId: string, deviceId: string): void {
    const uplink = registry.uplinkOf(hostId);
    if (!uplink) {
      return;
    }
    uplink.send(JSON.stringify({ type: "downlink.gone", deviceId }));
  }

  function attachUplink(socket: WebSocket, remoteAddress: string): void {
    if (uplinkHelloFailures.wouldExceed(remoteAddress)) {
      sendError(socket, "rate_limited");
      socket.close();
      return;
    }
    const connId = `u${connSeq}`;
    connSeq += 1;
    const nonce = randomBytes(24).toString("base64url");
    let hostId: string | null = null;
    let port: UplinkPort | null = null;
    const helloTimer = setTimeout(() => {
      if (hostId === null) {
        socket.close();
      }
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    socket.send(JSON.stringify({ type: "server.challenge", nonce }));

    socket.on("message", (data) => {
      if (!frameRate.hit(connId)) {
        sendError(socket, "rate_limited");
        socket.close();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        sendError(socket, "protocol_error");
        socket.close();
        return;
      }
      const frame = uplinkClientFrameSchema.safeParse(parsed);
      if (!frame.success) {
        if (hostId === null) {
          uplinkHelloFailures.hit(remoteAddress);
        }
        sendError(socket, "protocol_error");
        socket.close();
        return;
      }

      if (frame.data.type === "uplink.hello") {
        if (hostId !== null) {
          sendError(socket, "protocol_error");
          socket.close();
          return;
        }
        const accepted = verifyUplinkHello({
          hostId: frame.data.hostId,
          hostPubKey: frame.data.hostPubKey,
          signature: frame.data.signature,
          challengeNonce: nonce,
        });
        if (!accepted) {
          uplinkHelloFailures.hit(remoteAddress);
          sendError(socket, "auth_failed");
          socket.close();
          return;
        }
        hostId = frame.data.hostId;
        port = {
          send: (json) => {
            if (socket.readyState === socket.OPEN) {
              socket.send(json);
            }
          },
          close: () => socket.close(),
        };
        const kicked = registry.setOnline(hostId, port, frame.data.roster);
        kicked?.close();
        clearTimeout(helloTimer);
        socket.send(JSON.stringify({ type: "uplink.ready" }));
        log("uplink.online", { hostId, roster: frame.data.roster.length });
        return;
      }

      if (hostId === null || port === null) {
        sendError(socket, "protocol_error");
        socket.close();
        return;
      }
      registry.touch(hostId);

      if (frame.data.type === "roster.update") {
        const removed = registry.applyRosterUpdate(
          hostId,
          frame.data.upsert,
          frame.data.remove
        );
        for (const deviceId of removed) {
          closeDevicePipes(hostId, deviceId, "auth_failed");
        }
        log("roster.update", {
          hostId,
          upsert: frame.data.upsert?.length ?? 0,
          removed: removed.length,
        });
        return;
      }

      if (frame.data.type === "envelope") {
        const targets = pipes.get(hostId)?.get(frame.data.deviceId);
        if (!targets || targets.size === 0) {
          return;
        }
        const json = JSON.stringify(frame.data.frame);
        for (const target of targets) {
          if (target.readyState === target.OPEN) {
            target.send(json);
          }
        }
        return;
      }

      // pair.result
      const pending = pendingPairs.get(frame.data.requestId);
      if (pending) {
        pendingPairs.delete(frame.data.requestId);
        clearTimeout(pending.timer);
        pending.settle({
          kind: "result",
          ok: frame.data.ok,
          sealedResult: frame.data.sealedResult,
        });
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (
        hostId !== null &&
        port !== null &&
        registry.setOffline(hostId, port)
      ) {
        closeHostPipes(hostId, "host_offline");
        log("uplink.offline", { hostId });
      }
    });
    socket.on("error", () => socket.close());
  }

  function attachDownlink(socket: WebSocket, remoteAddress: string): void {
    if (
      downlinkHelloFailures.wouldExceed(remoteAddress) ||
      downlinkHellos.wouldExceed(remoteAddress)
    ) {
      sendError(socket, "rate_limited");
      socket.close();
      return;
    }
    const connId = `d${connSeq}`;
    connSeq += 1;
    let hostId: string | null = null;
    let deviceId: string | null = null;
    const helloTimer = setTimeout(() => {
      if (hostId === null) {
        socket.close();
      }
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();

    socket.on("message", (data) => {
      if (!frameRate.hit(connId)) {
        sendError(socket, "rate_limited");
        socket.close();
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        sendError(socket, "protocol_error");
        socket.close();
        return;
      }

      if (hostId === null || deviceId === null) {
        const hello = downlinkClientFrameSchema.safeParse(raw);
        if (
          !(hello.success && "type" in hello.data) ||
          hello.data.type !== "downlink.hello"
        ) {
          downlinkHelloFailures.hit(remoteAddress);
          sendError(socket, "protocol_error");
          socket.close();
          return;
        }
        if (!downlinkHellos.hit(remoteAddress)) {
          sendError(socket, "rate_limited");
          socket.close();
          return;
        }
        const { data } = hello;
        const admitted =
          registry.isOnline(data.hostId) &&
          registry.verifyPass(data.hostId, data.deviceId, data.relayPass);
        if (!admitted) {
          // 统一答 host_offline：不区分离线/不存在/通行证。诚实离线不计入失败窗，
          // 避免手机退避重试把同 IP 的宿主 uplink 也锁死。
          sendError(socket, "host_offline");
          socket.close();
          return;
        }
        const set = pipesOf(data.hostId, data.deviceId);
        if (set.size >= config.maxDownlinksPerDevice) {
          const oldest = set.values().next().value;
          if (oldest !== undefined) {
            set.delete(oldest);
            sendError(oldest, "rate_limited");
            oldest.close();
          }
        }
        hostId = data.hostId;
        deviceId = data.deviceId;
        set.add(socket);
        clearTimeout(helloTimer);
        socket.send(JSON.stringify({ type: "downlink.ready" }));
        log("downlink.open", { hostId, deviceId });
        return;
      }

      const carried = relayEnvelopeFrameSchema.safeParse(raw);
      if (!carried.success) {
        sendError(socket, "protocol_error");
        socket.close();
        return;
      }
      const uplink = registry.uplinkOf(hostId);
      if (!uplink) {
        sendError(socket, "host_offline");
        socket.close();
        return;
      }
      uplink.send(
        JSON.stringify({ type: "envelope", deviceId, frame: carried.data })
      );
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (hostId === null || deviceId === null) {
        return;
      }
      const set = pipes.get(hostId)?.get(deviceId);
      // 后来者踢掉时已从 set 删过：不能当成最后一条发 gone，否则会拆掉刚准入的管道。
      if (!set?.delete(socket)) {
        return;
      }
      const remaining = set.size;
      if (remaining === 0) {
        pipes.get(hostId)?.delete(deviceId);
        notifyDownlinkGone(hostId, deviceId);
      }
      log("downlink.close", { hostId, deviceId, remaining });
    });
    socket.on("error", () => socket.close());
  }

  function redeem(
    hostId: string,
    sealed: RelaySealedFrame
  ): Promise<RedeemOutcome> {
    const uplink = registry.uplinkOf(hostId);
    if (!uplink) {
      return Promise.resolve({ kind: "failure", reason: "host_offline" });
    }
    const requestId = randomUUID();
    return new Promise<RedeemOutcome>((resolve) => {
      const timer = setTimeout(() => {
        pendingPairs.delete(requestId);
        resolve({ kind: "failure", reason: "timeout" });
      }, config.pairResultTimeoutMs);
      timer.unref?.();
      pendingPairs.set(requestId, { settle: resolve, timer });
      uplink.send(
        JSON.stringify({
          type: "pair.request",
          requestId,
          sealedRequest: sealed,
        })
      );
    });
  }

  return { attachUplink, attachDownlink, redeem };
}
