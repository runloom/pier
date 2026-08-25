/**
 * CapabilityAuthority 骨架（W4-S4）。
 * 可替换 LocalControlAuthorizer；深度/跨项目/兄弟默认拒绝矩阵。
 * 产品终态：cli-human authorize + 运行时归属图。
 */
import type {
  LocalControlAuthorizeInput,
  LocalControlAuthorizeResult,
  LocalControlAuthorizer,
} from "../../adapters/cli/local-control/authorize.ts";
import { createDefaultLocalControlAuthorizer } from "../../adapters/cli/local-control/authorize.ts";

export interface CapabilityBudgetReservation {
  childRef: string;
  parentRef: string;
}

export type CapabilityReserveResult =
  | { ok: true; childRef: string }
  | { ok: false; code: "permission_denied"; message: string };

export interface CapabilityAuthority {
  /** 跨项目 / 兄弟互控默认拒绝（表驱动）。 */
  assertRuntimeAccess(input: {
    callerProjectRoot?: string | undefined;
    targetProjectRoot?: string | undefined;
    callerRuntimeId?: string | undefined;
    targetRuntimeId?: string | undefined;
    relation?: "self" | "child" | "sibling" | "other" | undefined;
  }): LocalControlAuthorizeResult;
  authorize(input: LocalControlAuthorizeInput): LocalControlAuthorizeResult;
  releaseChild?(parentRef: string, childRef: string): void;
  tryReserveChild?(
    parentRef: string,
    childRef?: string
  ): CapabilityReserveResult;
}

export interface CreateCapabilityAuthorityOptions {
  /** 可注入 base authorizer；默认 cli-human 规则 */
  base?: LocalControlAuthorizer;
  maxActiveChildren?: number;
}

/**
 * 默认实现：委托 base authorize；跨项目与兄弟默认 deny；
 * maxActiveChildren 进程内计数（骨架，非生产竞争矩阵）。
 */
export function createCapabilityAuthority(
  options: CreateCapabilityAuthorityOptions = {}
): CapabilityAuthority {
  const base = options.base ?? createDefaultLocalControlAuthorizer();
  const maxActiveChildren = options.maxActiveChildren ?? 4;
  const childrenByParent = new Map<string, Set<string>>();

  return {
    authorize(input) {
      return base.authorize(input);
    },

    assertRuntimeAccess(input) {
      if (
        input.callerProjectRoot &&
        input.targetProjectRoot &&
        input.callerProjectRoot !== input.targetProjectRoot
      ) {
        return {
          ok: false,
          code: "permission_denied",
          message: "cross-project runtime access denied by default",
        };
      }
      // sibling / other：默认拒绝（W6 归属图：非自己 start 的子 runtime）
      if (input.relation === "sibling" || input.relation === "other") {
        return {
          ok: false,
          code: "permission_denied",
          message:
            input.relation === "sibling"
              ? "sibling runtime access denied by default"
              : "unrelated runtime access denied by default",
        };
      }
      return { ok: true };
    },

    tryReserveChild(parentRef, childRef) {
      let set = childrenByParent.get(parentRef);
      if (!set) {
        set = new Set();
        childrenByParent.set(parentRef, set);
      }
      if (set.size >= maxActiveChildren) {
        return {
          ok: false,
          code: "permission_denied",
          message: `maxActiveChildren (${maxActiveChildren}) exceeded for parent`,
        };
      }
      const ref = childRef ?? `reserved:${set.size + 1}:${Date.now()}`;
      set.add(ref);
      return { ok: true, childRef: ref };
    },

    releaseChild(parentRef, childRef) {
      const set = childrenByParent.get(parentRef);
      if (!set) {
        return;
      }
      set.delete(childRef);
      // 释放任一占位时清全部 reserved:* 亦可；骨架只删精确 key
      if (set.size === 0) {
        childrenByParent.delete(parentRef);
      }
    },
  };
}

/** 将 Authority 适配为 session 使用的 LocalControlAuthorizer。 */
export function authorizerFromCapabilityAuthority(
  authority: CapabilityAuthority
): LocalControlAuthorizer {
  return {
    authorize: (input) => authority.authorize(input),
  };
}
