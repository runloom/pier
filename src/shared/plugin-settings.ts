import type {
  PluginConfigurationProperty,
  PluginRegistryEntry,
} from "./contracts/plugin.ts";
import type { JsonValue } from "./contracts/plugin-settings.ts";

export type ConfigurationValueValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** 前缀匹配一律按点分段精确匹配：`pier.git` 匹配 `pier.git.*`，不匹配 `pier.gitx.*`。 */
export function matchesConfigurationPrefix(
  prefix: string,
  key: string
): boolean {
  return key === prefix || key.startsWith(`${prefix}.`);
}

export function validateConfigurationValue(
  property: PluginConfigurationProperty,
  value: unknown
): ConfigurationValueValidation {
  if (typeof value !== property.type) {
    return { ok: false, reason: `expected ${property.type}` };
  }
  if (property.type === "number" && typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, reason: "expected a finite number" };
    }
    if (property.minimum !== undefined && value < property.minimum) {
      return { ok: false, reason: `minimum is ${property.minimum}` };
    }
    if (property.maximum !== undefined && value > property.maximum) {
      return { ok: false, reason: `maximum is ${property.maximum}` };
    }
  }
  if (
    property.enum &&
    typeof value === "string" &&
    !property.enum.includes(value)
  ) {
    return {
      ok: false,
      reason: `expected one of: ${property.enum.join(", ")}`,
    };
  }
  return { ok: true };
}

/** 生效值 = 用户值 ?? schema default；存量非法值（如 schema 演化后）按 default 兜底。 */
export function effectiveConfigurationValue(
  property: PluginConfigurationProperty,
  userValue: unknown
): JsonValue {
  if (userValue === undefined) {
    return property.default;
  }
  return validateConfigurationValue(property, userValue).ok
    ? (userValue as JsonValue)
    : property.default;
}

export function collectEnabledConfigurationProperties(
  entries: readonly PluginRegistryEntry[]
): ReadonlyMap<string, PluginConfigurationProperty> {
  const properties = new Map<string, PluginConfigurationProperty>();
  for (const entry of entries) {
    if (!(entry.runtime.enabled && entry.manifest.configuration)) {
      continue;
    }
    for (const [key, property] of Object.entries(
      entry.manifest.configuration.properties
    )) {
      properties.set(key, property);
    }
  }
  return properties;
}

export interface PluginConfigurationChangeEvent {
  affectsConfiguration(prefix: string): boolean;
}

export function createConfigurationChangeEvent(
  changedKeys: readonly string[]
): PluginConfigurationChangeEvent {
  return {
    affectsConfiguration: (prefix) =>
      changedKeys.some((key) => matchesConfigurationPrefix(prefix, key)),
  };
}

export function diffConfigurationValues(
  previous: Record<string, JsonValue>,
  next: Record<string, JsonValue>
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}
