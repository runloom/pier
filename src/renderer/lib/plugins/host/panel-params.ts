function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function clonePanelParamValue(
  value: unknown,
  seen = new WeakMap<object, unknown>()
): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(clonePanelParamValue(item, seen));
    }
    return clone;
  }
  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    seen.set(value, clone);
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = clonePanelParamValue(nested, seen);
    }
    return clone;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(value, clone);
    for (const [key, nested] of value) {
      clone.set(
        clonePanelParamValue(key, seen),
        clonePanelParamValue(nested, seen)
      );
    }
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>();
    seen.set(value, clone);
    for (const nested of value) {
      clone.add(clonePanelParamValue(nested, seen));
    }
    return clone;
  }
  if (value instanceof RegExp) {
    const clone = new RegExp(value.source, value.flags);
    clone.lastIndex = value.lastIndex;
    return clone;
  }
  try {
    return structuredClone(value);
  } catch {
    const clone: Record<string, unknown> = {};
    seen.set(value, clone);
    for (const [key, nested] of Object.entries(value)) {
      clone[key] = clonePanelParamValue(nested, seen);
    }
    return clone;
  }
}

export function clonePanelParams(
  params: Record<string, unknown> | undefined
): Readonly<Record<string, unknown>> | undefined {
  return params
    ? (clonePanelParamValue(params) as Readonly<Record<string, unknown>>)
    : undefined;
}

type SeenParamPairs = WeakMap<object, WeakSet<object>>;

function hasSeenParamPair(
  left: object,
  right: object,
  seen: SeenParamPairs
): boolean {
  const rightSet = seen.get(left);
  if (rightSet?.has(right)) {
    return true;
  }
  if (rightSet) {
    rightSet.add(right);
  } else {
    seen.set(left, new WeakSet([right]));
  }
  return false;
}

export function sameParamValue(
  left: unknown,
  right: unknown,
  seen: SeenParamPairs = new WeakMap()
): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right))) {
      return false;
    }
    if (hasSeenParamPair(left, right, seen)) {
      return true;
    }
    return (
      left.length === right.length &&
      left.every((value, index) => sameParamValue(value, right[index], seen))
    );
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!(isPlainObject(left) && isPlainObject(right))) {
      return false;
    }
    if (hasSeenParamPair(left, right, seen)) {
      return true;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(right, key) &&
          sameParamValue(left[key], right[key], seen)
      )
    );
  }
  if (typeof left === "object" || typeof right === "object") {
    return false;
  }
  return false;
}
