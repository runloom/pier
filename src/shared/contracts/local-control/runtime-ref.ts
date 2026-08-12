/**
 * 精确运行代际：写/精确读门禁（H7）。
 * AgentRef / PanelRef 仅发现与 focus，不得单独授权写。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const runtimeRefSchema = z
  .object({
    bootId: nonEmpty,
    runtimeId: nonEmpty,
    generation: z.number().int().nonnegative(),
  })
  .strict();

export type RuntimeRef = z.infer<typeof runtimeRefSchema>;

/** 三者全匹配才视为同一精确运行。 */
export function runtimeRefsEqual(a: RuntimeRef, b: RuntimeRef): boolean {
  return (
    a.bootId === b.bootId &&
    a.runtimeId === b.runtimeId &&
    a.generation === b.generation
  );
}

/**
 * 校验请求侧 RuntimeRef 是否仍指向当前控制面登记。
 * 返回稳定错误码，供 v2 response 使用。
 */
export type RuntimeRefMatchFailure =
  | "boot_changed"
  | "stale_generation"
  | "runtime_gone";

export function matchRuntimeRef(args: {
  expected: RuntimeRef;
  actual: RuntimeRef | null | undefined;
}): { ok: true } | { ok: false; code: RuntimeRefMatchFailure } {
  const { expected, actual } = args;
  if (!actual) {
    return { ok: false, code: "runtime_gone" };
  }
  if (actual.bootId !== expected.bootId) {
    return { ok: false, code: "boot_changed" };
  }
  if (actual.runtimeId !== expected.runtimeId) {
    return { ok: false, code: "runtime_gone" };
  }
  if (actual.generation !== expected.generation) {
    return { ok: false, code: "stale_generation" };
  }
  return { ok: true };
}
