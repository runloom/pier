/**
 * 会合地址解析（单一来源）：缺省即官方会合（用户零配置，对齐 Codex/Happy
 * 的「打开即用」默认）；dev/staging 经 `PIER_RELAY_URL` 覆盖指向本地/预发实例。
 * QR 的 relayHint 与宿主 uplink 拨号都只从这里取值。
 */

/** 官方会合 wss 基址（TLS 由 relay.pier.codes 的前置 Caddy 终结）。 */
const OFFICIAL_RELAY_URL: string | null = "wss://relay.pier.codes";

export function resolveRelayUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const override = env.PIER_RELAY_URL?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }
  return OFFICIAL_RELAY_URL;
}
