/**
 * pier.control/v2 稳定错误码（传输金标准）。
 * 与 v1 PierCommandErrorCode 分离，避免一次改爆全仓。
 */

export const LOCAL_CONTROL_V2_ERROR_CODES = [
  "protocol_unsupported",
  "frame_too_large",
  "peer_identity_denied",
  "auth_required",
  "auth_failed",
  "permission_denied",
  "capability_revoked",
  "boot_changed",
  "stale_generation",
  "idempotency_conflict",
  "effect_in_progress",
  "observation_timeout",
  "execution_deadline_exceeded",
  "concurrency_exceeded",
  "provider_unavailable",
  "effect_unknown",
  "unsupported",
  "invalid_command",
  "not_found",
  "snapshot_required",
  "internal_error",
] as const;

export type LocalControlV2ErrorCode =
  (typeof LOCAL_CONTROL_V2_ERROR_CODES)[number];

export const LOCAL_CONTROL_V2_API_VERSION = "pier.control/v2" as const;

/** 单帧最大字节（UTF-8），与传输金标准默认一致。 */
export const LOCAL_CONTROL_V2_MAX_FRAME_BYTES = 16 * 1024 * 1024;
