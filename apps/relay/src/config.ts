/**
 * relay 配置：全环境变量注入，无密钥材料、无数据库连接串（服务端设计 §10.2）。
 */

export interface RelayConfig {
  /** downlink hello 总次数（含诚实 host_offline）；与失败限速分开。 */
  downlinkHellosPerMinute: number;
  framesPerSecond: number;
  /** WS ping 间隔；一轮无 pong/入站则 terminate。 */
  heartbeatIntervalMs: number;
  helloFailuresPerMinute: number;
  maxDownlinksPerDevice: number;
  /** 赎回转发等待宿主应答的超时（毫秒）。 */
  pairResultTimeoutMs: number;
  port: number;
  publicUrl: string | null;
  redeemsPerHostPerHour: number;
  redeemsPerIpPerMinute: number;
  statusPerIpPerMinute: number;
}

function readInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  options: { min?: number } = {}
): number {
  const min = options.min ?? 1;
  const raw = env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`invalid ${key}: ${raw}`);
  }
  return parsed;
}

export function loadRelayConfig(
  env: Record<string, string | undefined> = process.env
): RelayConfig {
  return {
    port: readInt(env, "RELAY_PORT", 8787, { min: 0 }),
    publicUrl: env.RELAY_PUBLIC_URL?.trim() || null,
    maxDownlinksPerDevice: readInt(env, "RELAY_MAX_DOWNLINKS_PER_DEVICE", 2),
    framesPerSecond: readInt(env, "RELAY_FRAMES_PER_SECOND", 200),
    helloFailuresPerMinute: readInt(env, "RELAY_HELLO_FAILURES_PER_MINUTE", 5),
    downlinkHellosPerMinute: readInt(
      env,
      "RELAY_DOWNLINK_HELLOS_PER_MINUTE",
      60
    ),
    heartbeatIntervalMs: readInt(env, "RELAY_HEARTBEAT_INTERVAL_MS", 30_000),
    redeemsPerHostPerHour: readInt(env, "RELAY_REDEEMS_PER_HOST_PER_HOUR", 10),
    redeemsPerIpPerMinute: readInt(env, "RELAY_REDEEMS_PER_IP_PER_MINUTE", 5),
    statusPerIpPerMinute: readInt(env, "RELAY_STATUS_PER_IP_PER_MINUTE", 60),
    pairResultTimeoutMs: readInt(env, "RELAY_PAIR_RESULT_TIMEOUT_MS", 30_000),
  };
}
