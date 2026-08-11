/**
 * 写 op 幂等 receipt（boot 级内存，架构闭环）。
 * 后续可替换为 CapabilityAuthority receipt epoch。
 *
 * digest 使用 RFC 8785 风格递归 canonical JSON（对象键排序、嵌套一致），
 * 避免仅排序顶层键时嵌套键序导致的伪冲突 / 漏冲突。
 */
import { createHash } from "node:crypto";

export interface EffectReceipt {
  digest: string;
  effectKey: string;
  effectRevision: number;
  /** ok=false 时的错误 */
  error?: { code: string; message: string } | undefined;
  /** 成功时 true；失败终态也登记以防同 key 双执行 */
  ok: boolean;
  op: string;
  principalRef: string;
  /** ok=true 时的响应 data */
  responseData?: unknown;
}

export interface EffectReceiptStore {
  commit(receipt: EffectReceipt): void;
  lookup(args: {
    principalRef: string;
    op: string;
    effectKey: string;
  }): EffectReceipt | undefined;
  nextRevision(): number;
}

export function createEffectReceiptStore(): EffectReceiptStore {
  let rev = 0;
  const byKey = new Map<string, EffectReceipt>();

  const keyOf = (principalRef: string, op: string, effectKey: string) =>
    `${principalRef}\0${op}\0${effectKey}`;

  return {
    nextRevision() {
      rev += 1;
      return rev;
    },
    lookup({ principalRef, op, effectKey }) {
      return byKey.get(keyOf(principalRef, op, effectKey));
    },
    commit(receipt) {
      byKey.set(
        keyOf(receipt.principalRef, receipt.op, receipt.effectKey),
        receipt
      );
    },
  };
}

/**
 * RFC 8785 JCS 风格：递归规范化 JSON 文本（UTF-8 无空白）。
 * - object：键按 UTF-16 code unit 升序（JS string 比较）
 * - array：保序递归
 * - number：有限数走 JSON.stringify；非有限数抛错（params 不得含 NaN/Infinity）
 * - undefined / function / symbol / bigint：抛错（非 JSON）
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t === "boolean") {
    return value ? "true" : "false";
  }
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError("canonicalizeJson: non-finite number");
    }
    // JSON.stringify 对 number 的表示与 JCS 对有限数一致（含 -0 → 0）
    return JSON.stringify(value);
  }
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (t !== "object") {
    throw new TypeError(`canonicalizeJson: unsupported type ${t}`);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(item === undefined ? "null" : canonicalizeJson(item));
    }
    return `[${parts.join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${canonicalizeJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}

export function digestRequestParams(params: Record<string, unknown>): string {
  const json = canonicalizeJson(params);
  return createHash("sha256").update(json, "utf8").digest("hex");
}
