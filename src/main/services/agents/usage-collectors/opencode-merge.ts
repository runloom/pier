import type { UsageDataPublishInput } from "@pier/plugin-api/main";
import { filterByCoverageDate } from "./date-range.ts";

/**
 * 合并 OpenCode 新旧存储的观测。主存储原样保留；只有稳定消息标识相同的旧存储
 * 记录才去重，避免把 token 数量恰好相同的独立调用误判为重复。
 */
export function mergeOpenCodeInputs(
  primary: UsageDataPublishInput | null,
  secondary: UsageDataPublishInput | null
): UsageDataPublishInput | null {
  if (!(primary || secondary)) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  const seen = new Set<string>();
  const observations = [] as UsageDataPublishInput["observations"];
  for (const observation of primary.observations) {
    observations.push(observation);
    if (observation.eventId) seen.add(observation.eventId);
  }
  for (const observation of secondary.observations) {
    if (observation.eventId && seen.has(observation.eventId)) continue;
    observations.push(observation);
    if (observation.eventId) seen.add(observation.eventId);
  }
  const coverage = {
    complete: primary.coverage.complete && secondary.coverage.complete,
    from:
      primary.coverage.from > secondary.coverage.from
        ? primary.coverage.from
        : secondary.coverage.from,
    to:
      primary.coverage.to < secondary.coverage.to
        ? primary.coverage.to
        : secondary.coverage.to,
  };
  return {
    coverage,
    observations: filterByCoverageDate(
      observations,
      coverage.from,
      coverage.to
    ),
    observedAt: Math.max(primary.observedAt, secondary.observedAt),
    scope: primary.scope,
    sourceId: primary.sourceId,
  };
}
