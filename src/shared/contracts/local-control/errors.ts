/**
 * pier.control/v2 稳定错误码（传输金标准）。
 * 与 v1 PierCommandErrorCode 分离，避免一次改爆全仓。
 */

export const LOCAL_CONTROL_ERROR_CODES = [
  "protocol_unsupported",
  "frame_too_large",
  "peer_identity_denied",
  "auth_required",
  "auth_failed",
  "permission_denied",
  "capability_revoked",
  "boot_changed",
  "stale_generation",
  "runtime_gone",
  "panel_gone",
  "window_gone",
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
  "timeout",
  "snapshot_required",
  "internal_error",
  "invalid_origin",
  "quota_exceeded",
  "prompt_too_long",
  "prompt_undeliverable",
  "cross_window_unsupported",
  /** 移动端：令牌或 epoch 失效（吊销），随断连返回（规格 §17.1）。 */
  "device_revoked",
  /** 移动端：审批回写双重门拒绝（waiting + interactionId 过期）。 */
  "interaction_stale",
] as const;

export type LocalControlErrorCode = (typeof LOCAL_CONTROL_ERROR_CODES)[number];

export const LOCAL_CONTROL_API_VERSION = "pier.control/v2" as const;

/** 单帧最大字节（UTF-8），与传输金标准默认一致。 */
export const LOCAL_CONTROL_MAX_FRAME_BYTES = 16 * 1024 * 1024;
