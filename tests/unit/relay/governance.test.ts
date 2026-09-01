// @vitest-environment node
/**
 * M2 会合治理不变量（服务端设计 §13）：relay 盲性、零持久化、无账号、
 * 宿主只出站、QR relayHint 演进。全部静态源码断言（不跑运行时）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPairingQrPayload } from "@main/services/pairing/qr-payload.ts";
import { resolveRelayUrl } from "@main/services/pairing/relay-url.ts";
import { pairingQrPayloadSchema } from "@shared/contracts/remote.ts";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const RELAY_SRC = "apps/relay/src";

function relaySources(): string[] {
  return readdirSync(join(REPO_ROOT, RELAY_SRC), { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => `${RELAY_SRC}/${entry}`);
}

function readRelaySource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("不变量：relay 盲转发（不解密、不解析载体内容）", () => {
  it("relay 源码不 import 密封层，不解封、不解构密文字段", () => {
    for (const path of relaySources()) {
      const source = readRelaySource(path);
      expect(source.includes("e2e-seal"), path).toBe(false);
      expect(source.includes("unseal"), path).toBe(false);
      expect(source.includes("deriveChannelKey"), path).toBe(false);
      // 不解构密文字段 .ct / 不 JSON.parse envelope 的 .frame 内容。
      expect(/\.ct\b/.test(source), path).toBe(false);
      expect(/JSON\.parse\([^)]*\.frame/.test(source), path).toBe(false);
    }
  });

  it("relay 源码从不出现 deviceToken（令牌只对宿主出示）", () => {
    for (const path of relaySources()) {
      expect(readRelaySource(path).includes("deviceToken"), path).toBe(false);
    }
  });
});

describe("不变量：relay 零持久化 + 无账号", () => {
  it("relay 源码不 import 数据库 / 文件写路径", () => {
    for (const path of relaySources()) {
      const source = readRelaySource(path);
      expect(source.includes("node:sqlite"), path).toBe(false);
      expect(source.includes("writeFile"), path).toBe(false);
      expect(source.includes("createWriteStream"), path).toBe(false);
    }
  });

  it("relay 源码无账号 / OAuth 业务字样（去账号模型）", () => {
    for (const path of relaySources()) {
      const source = readRelaySource(path).toLowerCase();
      expect(source.includes("oauth"), path).toBe(false);
      expect(source.includes("github"), path).toBe(false);
      expect(source.includes("accountid"), path).toBe(false);
    }
  });

  it("Dockerfile 只装 relay 运行时依赖，不 COPY 仓库根 package.json", () => {
    const dockerfile = readFileSync(
      join(REPO_ROOT, "apps/relay/Dockerfile"),
      "utf8"
    );
    expect(dockerfile).toContain("COPY apps/relay/package.json ./package.json");
    expect(dockerfile.includes("COPY package.json pnpm-lock.yaml")).toBe(false);
  });
});

describe("不变量：宿主只出站（uplink 从不监听）", () => {
  it("uplink dialer 源码无 .listen( 调用", () => {
    const source = readRelaySource(
      "src/main/adapters/remote-control/uplink/dialer.ts"
    ).replaceAll(/\s+/g, "");
    // 允许注释里的说明；仅禁真实 .listen( 调用。
    const withoutComments = source.replace(/\/\/.*$/gm, "");
    expect(/\.listen\(/.test(withoutComments)).toBe(false);
  });
});

describe("不变量：QR relayHint 演进（未配置 null / 配置为 wss）", () => {
  it("未配置会合 → relayHint 恒 null（M1 纯 LAN 形态兼容）", () => {
    const raw = buildPairingQrPayload({
      code: "123456",
      fingerprint: "ab12cd34",
      host: "pier.local",
      port: 8787,
    });
    expect(JSON.parse(raw)).toHaveProperty("relayHint", null);
  });

  it("配置会合 → relayHint 为 wss URL 且携带 hostId / pairSecret", () => {
    const raw = buildPairingQrPayload({
      code: "123456",
      fingerprint: "ab12cd34",
      hostId: "a".repeat(64),
      pairSecret: "s".repeat(43),
      relayHint: "wss://relay.pier.codes",
    });
    const parsed = pairingQrPayloadSchema.parse(JSON.parse(raw));
    expect(parsed.relayHint).toBe("wss://relay.pier.codes");
    expect(parsed.hostId).toBe("a".repeat(64));
    expect(parsed.pairSecret).toHaveLength(43);
  });
});

describe("不变量：官方会合地址内置（用户零配置，G5）", () => {
  it("缺省即官方 wss 地址；PIER_RELAY_URL 仅作本地/预发覆盖（去尾斜杠）", () => {
    expect(resolveRelayUrl({})).toBe("wss://relay.pier.codes");
    expect(resolveRelayUrl({ PIER_RELAY_URL: "ws://127.0.0.1:8787/" })).toBe(
      "ws://127.0.0.1:8787"
    );
  });
});
