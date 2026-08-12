/**
 * W6-S4：agents start/turn/terminate 热路径挂 CapabilityAuthority。
 * 父子 runtime 归属图：默认仅允许操作自己 start 出的子 runtime。
 */
import type { LocalControlErrorCode } from "@shared/contracts/local-control/errors.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";

export interface CapabilityHotPathFail {
  code: LocalControlErrorCode;
  message: string;
  ok: false;
}

export interface StartReservation {
  childRef: string;
  parentRef: string;
}

/** parent principal → 其创建的 runtimeId 集合 */
const ownedRuntimesByParent = new Map<string, Set<string>>();
/** runtimeId → 占额，供 terminate 释放（boot 进程内）。 */
const reservationByRuntimeId = new Map<string, StartReservation>();

/** start 前原子占额；失败不创建 runtime。 */
export function reserveChildForStart(args: {
  authority: CapabilityAuthority | undefined;
  principalRef: string | undefined;
}): StartReservation | CapabilityHotPathFail | undefined {
  const authority = args.authority;
  if (!authority?.tryReserveChild) {
    return;
  }
  const parentRef = args.principalRef ?? "anonymous";
  const reserved = authority.tryReserveChild(parentRef);
  if (!reserved.ok) {
    return {
      ok: false,
      code: reserved.code,
      message: reserved.message,
    };
  }
  return { parentRef, childRef: reserved.childRef };
}

/** start 失败或 terminate 后释放。 */
export function releaseChildReservation(args: {
  authority: CapabilityAuthority | undefined;
  reservation: StartReservation | undefined;
}): void {
  if (!(args.authority && args.reservation && args.authority.releaseChild)) {
    return;
  }
  args.authority.releaseChild(
    args.reservation.parentRef,
    args.reservation.childRef
  );
}

export function rememberRuntimeReservation(
  runtimeId: string,
  reservation: StartReservation | undefined
): void {
  if (!reservation) {
    return;
  }
  reservationByRuntimeId.set(runtimeId, reservation);
  let set = ownedRuntimesByParent.get(reservation.parentRef);
  if (!set) {
    set = new Set();
    ownedRuntimesByParent.set(reservation.parentRef, set);
  }
  set.add(runtimeId);
}

export function releaseRuntimeReservation(args: {
  authority: CapabilityAuthority | undefined;
  runtimeId: string;
}): void {
  const reservation = reservationByRuntimeId.get(args.runtimeId);
  if (!reservation) {
    return;
  }
  reservationByRuntimeId.delete(args.runtimeId);
  ownedRuntimesByParent.get(reservation.parentRef)?.delete(args.runtimeId);
  releaseChildReservation({
    authority: args.authority,
    reservation,
  });
}

/**
 * 推导调用方与目标 runtime 的关系（进程内、start 占额图）：
 * - 本 principal start 的子 → child
 * - 其他 principal start → other（默认拒绝）
 * - 图中未知 → self（单 cli-human 产品：兼容 UI 起的 runtime）
 *
 * 产品 hello 固定 principalRef=human:peer，多会话共享同一 principal；
 * 本图是 start 预算/关系助手，不是多租户隔离。
 */
export function relationForRuntimeAccess(args: {
  principalRef: string | undefined;
  targetRuntimeId: string;
}): "self" | "child" | "sibling" | "other" {
  const parentRef = args.principalRef ?? "anonymous";
  const owned = ownedRuntimesByParent.get(parentRef);
  if (owned?.has(args.targetRuntimeId)) {
    return "child";
  }
  for (const [owner, set] of ownedRuntimesByParent) {
    if (owner !== parentRef && set.has(args.targetRuntimeId)) {
      return "other";
    }
  }
  return "self";
}

/**
 * turn / interrupt / terminate / screen / wait / watch 访问校验。
 */
export function assertRuntimeWriteAccess(args: {
  authority: CapabilityAuthority | undefined;
  principalRef?: string | undefined;
  targetRuntimeId?: string | undefined;
  callerProjectRoot?: string | undefined;
  targetProjectRoot?: string | undefined;
  relation?: "self" | "child" | "sibling" | "other" | undefined;
}): { ok: true } | CapabilityHotPathFail {
  if (!args.authority) {
    return { ok: true };
  }
  let relation = args.relation;
  if (relation === undefined && args.targetRuntimeId) {
    relation = relationForRuntimeAccess({
      principalRef: args.principalRef,
      targetRuntimeId: args.targetRuntimeId,
    });
  }
  const result = args.authority.assertRuntimeAccess({
    callerProjectRoot: args.callerProjectRoot,
    targetProjectRoot: args.targetProjectRoot,
    callerRuntimeId: undefined,
    targetRuntimeId: args.targetRuntimeId,
    relation: relation === "child" ? "child" : relation,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
    };
  }
  return { ok: true };
}

/** 返回拒绝结果；ok 则 null（调用方 map 到 controlErrorResponse）。 */
export function denyRuntimeAccess(args: {
  authority: CapabilityAuthority | undefined;
  principalRef?: string | undefined;
  targetRuntimeId?: string | undefined;
}): CapabilityHotPathFail | null {
  const r = assertRuntimeWriteAccess(args);
  return r.ok ? null : r;
}

/** 测试用：清空 runtime 占额与归属图。 */
export function resetRuntimeReservationsForTests(): void {
  reservationByRuntimeId.clear();
  ownedRuntimesByParent.clear();
}

/** 将占额信息并入 start 成功 data（最小子 CapabilityRef 指针）。 */
export function attachChildCapabilityRef(
  data: unknown,
  reservation: StartReservation | undefined
): unknown {
  if (!reservation || data === null || typeof data !== "object") {
    return data;
  }
  const record = data as Record<string, unknown>;
  const runtime = record.runtime;
  if (
    runtime &&
    typeof runtime === "object" &&
    "runtimeId" in runtime &&
    typeof (runtime as { runtimeId: unknown }).runtimeId === "string"
  ) {
    rememberRuntimeReservation(
      (runtime as { runtimeId: string }).runtimeId,
      reservation
    );
  }
  return {
    ...record,
    childCapabilityRef: {
      parentRef: reservation.parentRef,
      childRef: reservation.childRef,
    },
  };
}
