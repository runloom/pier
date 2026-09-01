export type PluginDataProjectionParams = Readonly<Record<string, string>>;

export interface PluginDataWatchTarget {
  key: string;
  params?: PluginDataProjectionParams;
  pluginId: string;
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Drop empty keys/values and sort remaining keys so lease ids and event
 * filters compare the same params regardless of insertion order.
 */
export function canonicalizePluginDataParams(
  params: unknown
): PluginDataProjectionParams | undefined {
  if (params == null || typeof params !== "object" || Array.isArray(params)) {
    return;
  }
  const entries: [string, string][] = [];
  for (const [rawKey, rawValue] of Object.entries(params)) {
    if (typeof rawValue !== "string" || rawKey.length === 0) {
      continue;
    }
    if (rawValue.length === 0) {
      continue;
    }
    entries.push([rawKey, rawValue]);
  }
  if (entries.length === 0) {
    return;
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

export function encodePluginDataParamsQuery(
  params: PluginDataProjectionParams
): string {
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
}

export function pluginDataParamsEqual(left: unknown, right: unknown): boolean {
  const canonicalLeft = canonicalizePluginDataParams(left);
  const canonicalRight = canonicalizePluginDataParams(right);
  if (canonicalLeft === undefined && canonicalRight === undefined) {
    return true;
  }
  if (canonicalLeft === undefined || canonicalRight === undefined) {
    return false;
  }
  return (
    encodePluginDataParamsQuery(canonicalLeft) ===
    encodePluginDataParamsQuery(canonicalRight)
  );
}

export function pluginDataProjectionLeaseId(
  pluginId: string,
  key: string,
  params?: PluginDataProjectionParams
): string {
  const canonical = canonicalizePluginDataParams(params);
  if (!canonical) {
    return `${pluginId}\0${key}`;
  }
  return `${pluginId}\0${key}\0${encodePluginDataParamsQuery(canonical)}`;
}

export function parsePluginDataProjectionKey(rawKey: string): {
  key: string;
  params?: PluginDataProjectionParams;
} {
  const queryStart = rawKey.indexOf("?");
  if (queryStart <= 0) {
    return { key: rawKey };
  }
  const key = rawKey.slice(0, queryStart);
  const params: Record<string, string> = {};
  for (const part of rawKey.slice(queryStart + 1).split("&")) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    const name = decodeQueryComponent(rawName);
    const value = decodeQueryComponent(rawValue);
    if (name.length > 0 && value.length > 0) {
      params[name] = value;
    }
  }
  const canonical = canonicalizePluginDataParams(params);
  if (!canonical) {
    return { key };
  }
  return { key, params: canonical };
}

export function resolvePluginDataProjectionIdentity(
  key: string,
  params?: unknown
): { key: string; params?: PluginDataProjectionParams } {
  const parsed = parsePluginDataProjectionKey(key);
  const fromArg = canonicalizePluginDataParams(params);
  if (fromArg) {
    return { key: parsed.key, params: fromArg };
  }
  if (parsed.params) {
    return { key: parsed.key, params: parsed.params };
  }
  return { key: parsed.key };
}

export function pluginDataCommandPayload(target: PluginDataWatchTarget): {
  key: string;
  params?: PluginDataProjectionParams;
  pluginId: string;
} {
  if (!target.params) {
    return { key: target.key, pluginId: target.pluginId };
  }
  return {
    key: target.key,
    params: target.params,
    pluginId: target.pluginId,
  };
}

/**
 * 解析插件数据投影 watch 目标 `"plugin:<pluginId>/<key>"`。
 * 查询串是 scope，不是基键：`"plugin:pier.tasks/board?milestone=x"`。
 *
 * 投影数据的顶层保留键（插件不得占用）：`payload`、`key`、`pluginId`、`params`。
 * 信封统一为 `{ key, pluginId, params?, ...数据 }`：对象 payload 走扁平合并
 * （信封字段之外即数据，见 {@link extractPluginDataEvent}）；非对象
 * payload 则包装为 `{ key, pluginId, params?, payload }`。
 */
export function parsePluginDataWatchTarget(
  target: string
): PluginDataWatchTarget | null {
  if (!target.startsWith("plugin:")) {
    return null;
  }
  const rest = target.slice("plugin:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    return null;
  }
  const pluginId = rest.slice(0, slash);
  const parsed = parsePluginDataProjectionKey(rest.slice(slash + 1));
  if (parsed.key.length === 0) {
    return null;
  }
  if (!parsed.params) {
    return { key: parsed.key, pluginId };
  }
  return { key: parsed.key, params: parsed.params, pluginId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 广播事件按 pluginId/基键/规范化 params 过滤；两种 payload 形状信封字段一致。 */
export function isPluginDataEventFor(
  event: unknown,
  target: PluginDataWatchTarget
): boolean {
  return (
    isRecord(event) &&
    event.pluginId === target.pluginId &&
    event.key === target.key &&
    pluginDataParamsEqual(event.params, target.params)
  );
}

/**
 * 提取插件数据投影事件的数据：对象 payload 扁平合并时剥掉信封字段
 * （key/pluginId/params）后剩余属性即数据；非对象 payload 经 `{payload,...}`
 * 包装，直接取 `payload` 键。非记录事件返回 null。
 */
export function extractPluginDataEvent(event: unknown): unknown {
  if (!isRecord(event)) {
    return null;
  }
  if ("payload" in event) {
    return event.payload;
  }
  const {
    key: _envelopeKey,
    params: _envelopeParams,
    pluginId: _envelopePluginId,
    ...data
  } = event;
  return data;
}
