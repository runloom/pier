/**
 * LAN 网络底座：本网 IPv4 枚举与固定区间端口选取。
 * 端口区间 47000–47099（全局约束），随机起试、listen 试探占用。
 */
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

export const LAN_PORT_MIN = 47_000;
export const LAN_PORT_MAX = 47_099;

/** 169.254.0.0/16：DHCP 失败自分配的 link-local 段，不可作 LAN 绑定/广告地址。 */
const LINK_LOCAL_PREFIX = "169.254.";

/** 本网卡 LAN IPv4（过滤 internal、非 IPv4 与 link-local），首枚作 QR 载荷的 host。 */
export function listLanIPv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (
        info.family === "IPv4" &&
        !info.internal &&
        !info.address.startsWith(LINK_LOCAL_PREFIX)
      ) {
        addresses.push(info.address);
      }
    }
  }
  return addresses;
}

function probePort(port: number, host: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.once("listening", () => {
    probe.close(() => resolve(true));
  });
  probe.listen(port, host);
  return promise;
}

async function probePortFree(port: number): Promise<boolean> {
  // 0.0.0.0 空闲不代表 127.0.0.1 空闲（本机 Pier 常只绑 loopback / LAN）。
  return (
    (await probePort(port, "0.0.0.0")) && (await probePort(port, "127.0.0.1"))
  );
}

/**
 * 区间内选空闲端口：preferred 在区间内则先试，再从随机起点环绕试探；
 * 全程 listen 实测占用，区间耗尽抛错。
 */
export async function pickPortInRange(preferred?: number): Promise<number> {
  const size = LAN_PORT_MAX - LAN_PORT_MIN + 1;
  const offset = Math.floor(Math.random() * size);
  const candidates: number[] = [];
  if (
    preferred !== undefined &&
    preferred >= LAN_PORT_MIN &&
    preferred <= LAN_PORT_MAX
  ) {
    candidates.push(preferred);
  }
  for (let index = 0; index < size; index += 1) {
    const port = LAN_PORT_MIN + ((offset + index) % size);
    if (port !== preferred) {
      candidates.push(port);
    }
  }
  for (const port of candidates) {
    if (await probePortFree(port)) {
      return port;
    }
  }
  throw new Error(`no free port in ${LAN_PORT_MIN}-${LAN_PORT_MAX}`);
}
