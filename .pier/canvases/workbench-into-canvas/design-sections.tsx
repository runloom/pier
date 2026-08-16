import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  MermaidDiagram,
  Stack,
  Text,
} from "pier/canvas";
import { KitFrames } from "./kit-frames.tsx";
import type { SchemeData } from "./model.ts";
import {
  BulletList,
  DataTable,
  SectionLead,
  SectionTitle,
  StatusBadge,
} from "./shared.tsx";

type DesignData = SchemeData["data"];

export function DesignPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <SectionTitle>目标形态</SectionTitle>
        <Text className="max-w-3xl text-sm leading-relaxed">{d.decision}</Text>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>分层架构</SectionTitle>
        <MermaidDiagram
          aria-label="文件树、pier/canvas SDK、宿主 store 与 Live Modules 围栏"
          previewTitle="Canvas 物料分层"
          source={d.architecture.diagram}
        />
        <SectionLead>
          数据块与文件钩子活在宿主；Canvas 只 import pier/canvas。工作台网格不是看见面。
        </SectionLead>
      </Stack>

      <Stack gap={6}>
        <SectionTitle>分层纪律</SectionTitle>
        <BulletList items={d.architecture.notes} />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>物料类型</SectionTitle>
        <DataTable
          caption="物料类型"
          headers={["类型", "来源", "v1", "排除"]}
          rows={d.families.map((family) => [
            family.title,
            family.source,
            family.v1,
            family.excluded,
          ])}
        />
        <Accordion className="w-full" collapsible type="single">
          <AccordionItem value="family-items">
            <AccordionTrigger>各类型条目</AccordionTrigger>
            <AccordionContent>
              <Stack gap={10}>
                {d.families.map((family) => (
                  <Stack gap={4} key={family.id}>
                    <Text className="text-sm font-medium">{family.title}</Text>
                    <BulletList items={family.items} />
                  </Stack>
                ))}
              </Stack>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Stack>

      <Stack gap={8}>
        <SectionTitle>所有权</SectionTitle>
        <DataTable
          caption="分层所有权"
          headers={["层", "所有者", "持有", "禁止持有"]}
          rows={d.layers.map((row) => [row.layer, row.owner, row.owns, row.mustNotOwn])}
        />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>设计稿</SectionTitle>
        <SectionLead>
          和分层架构图同一套卡片：阅读页看全部缩略，滚轮仍滚页面。点全屏再放大、缩小、拖拽。帧是固定桌面视口，不在帧里再滚。发现面：搜索加类型下拉、两列预览卡；点开宿主内容弹窗看实样、安装、用法和接口。
        </SectionLead>
        <KitFrames frames={d.productFrames} />
      </Stack>

      <Stack gap={8}>
        <SectionTitle>备选</SectionTitle>
        <DataTable
          caption="备选方案"
          headers={["方案", "处理", "原因"]}
          rows={d.alternatives.map((row) => [
            row.name,
            <StatusBadge key={row.name} label={row.disposition} />,
            row.reason,
          ])}
        />
      </Stack>
    </Stack>
  );
}
