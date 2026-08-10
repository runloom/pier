/**
 * 本机控制 peer 身份（T2）。
 *
 * Unix 校验优先级：
 * 1. 注入 resolvePeerUid（测试 / 宿主注册的 getpeereid·SO_PEERCRED）
 * 2. 平台默认 tryResolveUnixPeerUid（见下）
 * 3. fs-acl：socket 文件所有者 == host EUID 且 mode 无 other/group 位
 *
 * tryResolveUnixPeerUid：
 * - 若宿主通过 registerUnixPeerUidResolver 注册了原生解析器，则用之（生产推荐：
 *   getpeereid / SO_PEERCRED）
 * - 否则返回 null，退回 fs-acl（socket 0600 + 所有者校验）。
 *   同 UID 本机控制威胁模型下 fs-acl 为合法生产兜底；root 连入等场景需原生 peer UID。
 *
 * Windows：T2 以同用户假设 + 可注入校验为主（完整 SID 需原生能力，后续增强）。
 * 失败不得附带 bootId / 项目路径。
 */
import { statSync } from "node:fs";
import type { Socket } from "node:net";

export interface PeerIdentityOk {
  method: "peer-uid" | "fs-acl" | "inject" | "win32-same-user";
  ok: true;
  uid: number;
}

export interface PeerIdentityDenied {
  code: "peer_identity_denied";
  message: string;
  ok: false;
}

export type PeerIdentityResult = PeerIdentityOk | PeerIdentityDenied;

export type ResolvePeerUid = (socket: Socket) => number | null;

export interface CheckPeerIdentityArgs {
  /** 期望 UID，默认 process.geteuid?.() ?? process.getuid?.() */
  expectedUid?: number;
  platform?: NodeJS.Platform;
  /** 强制要求 peer UID（测试拒绝路径） */
  requirePeerUid?: boolean;
  /** 测试或平台原生解析 peer UID；返回 null 表示不可用 */
  resolvePeerUid?: ResolvePeerUid;
  socket: Socket;
  /** Unix socket 路径，用于 fs-acl 校验所有者 */
  socketPath?: string;
}

/** 宿主可注册原生 getpeereid / SO_PEERCRED 解析器（进程级单槽）。 */
let platformPeerUidResolver: ResolvePeerUid | null = null;

export function registerUnixPeerUidResolver(
  resolver: ResolvePeerUid | null
): void {
  platformPeerUidResolver = resolver;
}

export function getRegisteredUnixPeerUidResolver(): ResolvePeerUid | null {
  return platformPeerUidResolver;
}

function hostUid(): number | null {
  if (typeof process.geteuid === "function") {
    return process.geteuid();
  }
  if (typeof process.getuid === "function") {
    return process.getuid();
  }
  return null;
}

/**
 * 从已连接的 Unix domain socket 取 peer uid。
 * 优先宿主注册的原生解析器；否则 null → 由 fs-acl 兜底。
 */
export function tryResolveUnixPeerUid(socket: Socket): number | null {
  if (platformPeerUidResolver) {
    try {
      const uid = platformPeerUidResolver(socket);
      if (typeof uid === "number" && Number.isFinite(uid) && uid >= 0) {
        return uid;
      }
    } catch {
      // 原生失败不得阻断；退 fs-acl
    }
  }
  // 无注册原生解析器时不假装解析成功；由 fs-acl 兜底。
  return null;
}

/**
 * 读取底层 fd（供原生 resolver 使用）。Node 无稳定公开 API 时可能为 null。
 */
export function extractSocketFd(socket: Socket): number | null {
  try {
    const handle = (
      socket as unknown as {
        _handle?: { fd?: number };
      }
    )._handle;
    const fd = handle?.fd;
    if (typeof fd === "number" && fd >= 0) {
      return fd;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 用原生 getPeerUid(fd) 工厂构造 ResolvePeerUid（供 main 在加载 native 后注册）。
 */
export function createFdPeerUidResolver(
  getPeerUidFromFd: (fd: number) => number | null
): ResolvePeerUid {
  return (socket: Socket) => {
    const fd = extractSocketFd(socket);
    if (fd === null) {
      return null;
    }
    try {
      const uid = getPeerUidFromFd(fd);
      if (typeof uid === "number" && Number.isFinite(uid) && uid >= 0) {
        return uid;
      }
      return null;
    } catch {
      return null;
    }
  };
}

function checkUnixSocketOwnership(
  socketPath: string,
  expectedUid: number
): PeerIdentityDenied | null {
  try {
    const st = statSync(socketPath);
    if (typeof st.uid === "number" && st.uid !== expectedUid) {
      return {
        ok: false,
        code: "peer_identity_denied",
        message: "control socket not owned by host user",
      };
    }
    // 允许 group/other 任一读或写则拒绝
    // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
    const mode = st.mode & 0o777;
    // biome-ignore lint/suspicious/noBitwiseOperators: Unix file mode mask
    if ((mode & 0o077) !== 0) {
      return {
        ok: false,
        code: "peer_identity_denied",
        message: "control socket permissions too open",
      };
    }
    return null;
  } catch {
    return {
      ok: false,
      code: "peer_identity_denied",
      message: "control socket identity unproven",
    };
  }
}

/**
 * 连接建立后、处理任何业务帧前调用。
 */
export function checkLocalControlPeerIdentity(
  args: CheckPeerIdentityArgs
): PeerIdentityResult {
  const platform = args.platform ?? process.platform;
  const expected = args.expectedUid ?? hostUid();

  if (expected === null) {
    if (platform === "win32") {
      return { ok: true, uid: 0, method: "win32-same-user" };
    }
    return {
      ok: false,
      code: "peer_identity_denied",
      message: "host user id unavailable",
    };
  }

  const resolve = args.resolvePeerUid ?? tryResolveUnixPeerUid;
  const peerUid = resolve(args.socket);
  const usedInject = Boolean(args.resolvePeerUid);

  if (typeof peerUid === "number") {
    if (peerUid !== expected) {
      return {
        ok: false,
        code: "peer_identity_denied",
        message: "peer user does not match host",
      };
    }
    return {
      ok: true,
      uid: peerUid,
      method: usedInject ? "inject" : "peer-uid",
    };
  }

  if (args.requirePeerUid) {
    return {
      ok: false,
      code: "peer_identity_denied",
      message: "peer user id unproven",
    };
  }

  if (platform === "win32") {
    return { ok: true, uid: expected, method: "win32-same-user" };
  }

  if (args.socketPath) {
    const denied = checkUnixSocketOwnership(args.socketPath, expected);
    if (denied) {
      return denied;
    }
  }

  return { ok: true, uid: expected, method: "fs-acl" };
}
