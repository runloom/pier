import { describe, expect, it } from "vitest";
import type { MetricDescriptor } from "@/lib/mission-control/metric-registry.ts";
import {
  blockAcceptsMetric,
  parseCustomCardParams,
} from "@/panel-kits/mission-control/core-widgets/custom-card/custom-card-params.ts";

function descriptor(
  kind: MetricDescriptor["kind"],
  format: MetricDescriptor["format"]
): MetricDescriptor {
  return { format, id: "m", kind, titleKey: "t" };
}

describe("parseCustomCardParams", () => {
  it("空/非法 params 回退空区块列表", () => {
    expect(parseCustomCardParams({})).toEqual({ blocks: [] });
    expect(parseCustomCardParams({ blocks: "junk" })).toEqual({ blocks: [] });
  });

  it("混合合法/非法区块逐条抢救", () => {
    const parsed = parseCustomCardParams({
      blocks: [
        { id: "b1", metricId: "core.activity.total", type: "kpi" },
        { id: "b2", metricId: "", type: "kpi" }, // metricId 空
        { id: "b3", metricId: "m", type: "pie" }, // 未知块型
        { id: "b4", label: "CPU", metricId: "core.system.cpu", type: "gauge" },
      ],
    });
    expect(parsed.blocks.map((b) => b.id)).toEqual(["b1", "b4"]);
    expect(parsed.blocks[1]?.label).toBe("CPU");
  });
});

describe("blockAcceptsMetric", () => {
  it("kpi 只吃即时值", () => {
    expect(blockAcceptsMetric("kpi", descriptor("instant", "count"))).toBe(
      true
    );
    expect(blockAcceptsMetric("kpi", descriptor("series", "count"))).toBe(
      false
    );
  });

  it("gauge 只吃 percent 即时值", () => {
    expect(blockAcceptsMetric("gauge", descriptor("instant", "percent"))).toBe(
      true
    );
    expect(blockAcceptsMetric("gauge", descriptor("instant", "bytes"))).toBe(
      false
    );
  });

  it("trend 吃序列、ranking 吃分组", () => {
    expect(blockAcceptsMetric("trend", descriptor("series", "percent"))).toBe(
      true
    );
    expect(blockAcceptsMetric("trend", descriptor("instant", "percent"))).toBe(
      false
    );
    expect(blockAcceptsMetric("ranking", descriptor("grouped", "count"))).toBe(
      true
    );
    expect(blockAcceptsMetric("ranking", descriptor("instant", "count"))).toBe(
      false
    );
  });
});
