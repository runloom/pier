import type { JsonValue } from "../../../shared/contracts/plugin-settings.ts";

export const GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES = 32 * 1024 * 1024;
export const GIT_REVIEW_COMMIT_LRU_MAX_JSON_DEPTH = 128;

interface GitReviewCommitLruEntry<Value> {
  readonly value: Value;
  readonly weightBytes: number;
}

export interface CreateGitReviewCommitLruOptions {
  maxWeightBytes?: number;
}

/**
 * commit source 是不可变内容：同一 key 首次写入后不允许被不同值覆盖。
 * Map 的插入顺序同时作为 LRU 顺序，尾部是最近访问项。
 */
export class GitReviewCommitLru<Value extends JsonValue> {
  readonly #entries = new Map<string, GitReviewCommitLruEntry<Value>>();
  readonly #maxWeightBytes: number;
  #weightBytes = 0;

  constructor(options: CreateGitReviewCommitLruOptions = {}) {
    this.#maxWeightBytes =
      options.maxWeightBytes ?? GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES;
    assertPositiveSafeInteger(this.#maxWeightBytes, "maxWeightBytes");
    if (this.#maxWeightBytes > GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES) {
      throw new RangeError(
        `maxWeightBytes must not exceed ${GIT_REVIEW_COMMIT_LRU_MAX_WEIGHT_BYTES}`
      );
    }
  }

  get maxWeightBytes(): number {
    return this.#maxWeightBytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  get weightBytes(): number {
    return this.#weightBytes;
  }

  clear(): void {
    this.#entries.clear();
    this.#weightBytes = 0;
  }

  get(key: string): Value | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return;
    }
    this.#touch(key, entry);
    return entry.value;
  }

  /**
   * 返回 true 表示首次写入成功；已有 key 只提升热度并保留原不可变值。
   * 单项超过总预算时不缓存，也不会逐出已有热数据。
   */
  set(key: string, value: Value, weightBytes: number): boolean {
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      this.#touch(key, existing);
      return false;
    }
    assertPositiveSafeInteger(weightBytes, "weightBytes");
    if (weightBytes > this.#maxWeightBytes) {
      return false;
    }
    assertDeeplyFrozenJsonValue(value);
    while (
      this.#entries.size > 0 &&
      this.#weightBytes + weightBytes > this.#maxWeightBytes
    ) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.#delete(oldestKey);
    }
    this.#entries.set(key, { value, weightBytes });
    this.#weightBytes += weightBytes;
    return true;
  }

  #touch(key: string, entry: GitReviewCommitLruEntry<Value>): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
  }

  #delete(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return;
    }
    this.#entries.delete(key);
    this.#weightBytes -= entry.weightBytes;
  }
}

function assertDeeplyFrozenJsonValue(value: JsonValue): void {
  type WorkItem =
    | { depth: number; kind: "enter"; value: unknown }
    | { kind: "leave"; value: object };
  const states = new WeakMap<object, "done" | "visiting">();
  const work: WorkItem[] = [{ depth: 0, kind: "enter", value }];

  while (work.length > 0) {
    const item = work.pop();
    if (item === undefined) {
      break;
    }
    if (item.kind === "leave") {
      states.set(item.value, "done");
      continue;
    }
    if (item.depth > GIT_REVIEW_COMMIT_LRU_MAX_JSON_DEPTH) {
      throw new TypeError(
        `commit LRU JSON depth must not exceed ${GIT_REVIEW_COMMIT_LRU_MAX_JSON_DEPTH}`
      );
    }
    if (isJsonPrimitive(item.value)) {
      continue;
    }
    if (typeof item.value !== "object" || item.value === null) {
      throw new TypeError("commit LRU values must contain only JSON values");
    }
    const state = states.get(item.value);
    if (state === "visiting") {
      throw new TypeError("commit LRU values must not contain cycles");
    }
    if (state === "done") {
      continue;
    }
    assertFrozenJsonContainer(item.value);
    states.set(item.value, "visiting");
    work.push({ kind: "leave", value: item.value });
    const children = Array.isArray(item.value)
      ? jsonArrayChildren(item.value)
      : jsonObjectChildren(item.value);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      work.push({
        depth: item.depth + 1,
        kind: "enter",
        value: children[index],
      });
    }
  }
}

function assertFrozenJsonContainer(value: object): void {
  const prototype = Object.getPrototypeOf(value) as unknown;
  const validPrototype = Array.isArray(value)
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null;
  if (!validPrototype) {
    throw new TypeError("commit LRU values must be frozen plain JSON data");
  }
  if (!Object.isFrozen(value)) {
    throw new TypeError("commit LRU values must be deeply frozen");
  }
}

function isJsonPrimitive(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("commit LRU JSON numbers must be finite");
    }
    return true;
  }
  return false;
}

function jsonArrayChildren(value: readonly unknown[]): readonly unknown[] {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new TypeError("commit LRU arrays must not contain symbol keys");
    }
    if (key === "length") {
      continue;
    }
    const index = Number(key);
    if (
      !(
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < value.length &&
        String(index) === key
      )
    ) {
      throw new TypeError(
        "commit LRU arrays must not contain extra properties"
      );
    }
  }
  const children: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError("commit LRU arrays must not contain holes");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError("commit LRU arrays must contain plain data entries");
    }
    children.push(descriptor.value);
  }
  return children;
}

function jsonObjectChildren(value: object): readonly unknown[] {
  const children: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new TypeError("commit LRU objects must not contain symbol keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError("commit LRU objects must contain plain data fields");
    }
    children.push(descriptor.value);
  }
  return children;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!(Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
