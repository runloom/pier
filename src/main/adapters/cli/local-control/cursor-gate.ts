/**
 * 资源 cursor 续接门禁（W6-S5）。
 * control.watch 与 v2 subscribe 共用，禁止双份规则。
 */

import {
  type ControlCursorAfter,
  type ControlCursorScope,
  normalizeControlCursorAfter,
} from "@shared/contracts/local-control/cursor.ts";
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";

export interface CursorResumeSuccess {
  bootId: string;
  /** 无 after → 先 snapshot；有 after → resume（不回放历史 ring） */
  mode: "snapshot" | "resume";
  ok: true;
  /** 无 after 时为 -1，调用方先发 snapshot */
  revision: number;
  scope: ControlCursorScope | string;
}

export interface CursorResumeFailure {
  code: LocalControlErrorCode;
  message: string;
  ok: false;
}

export interface AssertCursorResumeInput {
  after: ControlCursorAfter | undefined;
  /** 本 op/stream 的 cursorScope */
  expectedScope: ControlCursorScope | string;
  /**
   * 可选：有界事件环的最低可续读 revision。
   * 产品 control.watch / global subscribe 为 digest 轮询，无历史环，不传此字段。
   * 单测与将来有环的 stream 才传；after.revision < min → snapshot_required。
   */
  minRetainedRevision?: number;
  sessionBootId: string;
}

/**
 * 校验 after 是否可在本会话/本 scope 续接。
 * - 错 boot → snapshot_required（message 含 boot_changed）
 * - 跨 scope → snapshot_required
 * - 低于保留水位 → snapshot_required
 * - 无 after → mode snapshot
 */
export function assertCursorResume(
  input: AssertCursorResumeInput
): CursorResumeSuccess | CursorResumeFailure {
  const { after, sessionBootId, expectedScope, minRetainedRevision } = input;

  if (after === undefined) {
    return {
      ok: true,
      revision: -1,
      scope: expectedScope,
      bootId: sessionBootId,
      mode: "snapshot",
    };
  }

  const normalized = normalizeControlCursorAfter(after);
  const bootId = normalized.bootId ?? sessionBootId;
  const scope = normalized.scope ?? expectedScope;

  if (bootId !== sessionBootId) {
    return {
      ok: false,
      code: "snapshot_required",
      message: "boot_changed for cursor; snapshot_required",
    };
  }

  if (scope !== expectedScope) {
    return {
      ok: false,
      code: "snapshot_required",
      message: `cursor scope mismatch: after.scope=${scope} expected=${expectedScope}; snapshot_required`,
    };
  }

  if (
    minRetainedRevision !== undefined &&
    normalized.revision < minRetainedRevision
  ) {
    return {
      ok: false,
      code: "snapshot_required",
      message: "cursor expired (below retained high-water); snapshot_required",
    };
  }

  return {
    ok: true,
    revision: normalized.revision,
    scope: expectedScope,
    bootId: sessionBootId,
    mode: "resume",
  };
}
