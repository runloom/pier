import { Mermaid, Stack, Text } from "pier/canvas";
import type { SchemeData } from "./model.ts";
import {
  BulletList,
  DataTable,
  SectionLead,
  SectionTitle,
  StatusBadge,
} from "./shared.tsx";

type DesignData = SchemeData["data"];

export function LandingPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <SectionTitle>落地波次</SectionTitle>
        <SectionLead>
          本文件只钉方案。实现从 P0 设置→项目物料列表开始，不先改工作台网格。
        </SectionLead>
        <DataTable
          caption="里程碑"
          headers={["阶段", "标题", "交付"]}
          rows={d.milestones.map((step) => [step.id, step.title, step.deliver])}
          monoFirst
        />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>交付依赖</SectionTitle>
        <Mermaid
          aria-label="P0 项目列表到 P3 成本与 Skill 的交付顺序"
          direction={d.delivery.diagram.direction}
          edges={d.delivery.diagram.edges}
          nodes={d.delivery.diagram.nodes}
        />
        <Text className="text-sm leading-relaxed text-muted-foreground">
          {d.delivery.caption}
        </Text>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>验收</SectionTitle>
        <DataTable
          caption="验收"
          headers={["ID", "标准", "证据", "状态"]}
          rows={d.acceptance.map((row) => [
            row.id,
            row.text,
            row.evidence,
            <StatusBadge key={row.id} label={row.status} />,
          ])}
          monoFirst
        />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>风险</SectionTitle>
        <DataTable
          caption="风险"
          headers={["ID", "风险", "缓解"]}
          rows={d.risks.map((row) => [row.id, row.text, row.mitigation])}
          monoFirst
        />
      </Stack>

      <Stack gap={6}>
        <SectionTitle>已知债</SectionTitle>
        <BulletList items={d.knownDebt} />
      </Stack>
    </Stack>
  );
}
