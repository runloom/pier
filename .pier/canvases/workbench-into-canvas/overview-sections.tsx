import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Mermaid,
  Stack,
  Text,
} from "pier/canvas";
import type { SchemeData } from "./model.ts";
import {
  BulletList,
  DataTable,
  SectionLead,
  SectionTitle,
  SubTitle,
} from "./shared.tsx";

type DesignData = SchemeData["data"];

export function OverviewPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      <Stack gap={8}>
        <Text className="max-w-3xl text-base font-medium leading-relaxed tracking-tight">
          {d.insight}
        </Text>
        <SectionLead>{d.meta.subtitle}</SectionLead>
      </Stack>

      <Card className="border-status-info/30 bg-status-info/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">结论</CardTitle>
        </CardHeader>
        <CardContent>
          <Text className="text-sm leading-relaxed">{d.bluf}</Text>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {d.overviewCards.map((card) => (
          <Card key={card.id}>
            <CardHeader className="pb-2">
              <Badge
                variant={
                  card.id === "problem"
                    ? "warning"
                    : card.id === "landing"
                      ? "success"
                      : "info"
                }
              >
                {card.badge}
              </Badge>
              <CardTitle className="mt-2 text-base">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Text className="text-sm leading-relaxed">{card.body}</Text>
            </CardContent>
          </Card>
        ))}
      </div>

      <Stack gap={8}>
        <SectionTitle>主回路</SectionTitle>
        <Mermaid
          aria-label="看见路径：设置项目物料列表打开文档弹窗或项目画布。生成路径：独立 Skill 写入画布文件并在文件树预览。两条路径不相连。"
          direction={d.mainLoop.diagram.direction}
          edges={d.mainLoop.diagram.edges}
          nodes={d.mainLoop.diagram.nodes}
        />
        <Text className="text-sm leading-relaxed text-muted-foreground">
          {d.mainLoop.caption}
        </Text>
      </Stack>
    </Stack>
  );
}

export function ProblemPage({ d }: { d: DesignData }) {
  return (
    <Stack gap={20}>
      <Alert variant="warning">
        <AlertTitle>{d.problem.title}</AlertTitle>
        <AlertDescription className="text-sm leading-relaxed">
          {d.problem.thesis}
        </AlertDescription>
      </Alert>

      <Stack gap={8}>
        <SectionTitle>主痛点</SectionTitle>
        <ItemGroup className="grid gap-3">
          {d.problem.pains.map((pain, index) => (
            <Item key={pain.id} size="sm" variant={index === 0 ? "outline" : "muted"}>
              <ItemContent>
                <ItemTitle>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">
                    {pain.id}
                  </span>
                  {pain.title}
                </ItemTitle>
                <ItemDescription className="leading-relaxed">{pain.detail}</ItemDescription>
                <Text className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  后果：{pain.consequence}
                </Text>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </Stack>

      <Stack gap={6}>
        <SectionTitle>做与不做</SectionTitle>
        <div className="grid gap-8 lg:grid-cols-2">
          <Stack gap={6}>
            <SubTitle>做</SubTitle>
            <BulletList items={d.goals} />
          </Stack>
          <Stack gap={6}>
            <SubTitle>不做</SubTitle>
            <BulletList items={d.nonGoals} />
          </Stack>
        </div>
      </Stack>

      <Accordion className="w-full" collapsible type="single">
        <AccordionItem value="current">
          <AccordionTrigger>当前能力对照</AccordionTrigger>
          <AccordionContent>
            <DataTable
              caption="当前能力"
              headers={["领域", "现在", "仍缺"]}
              rows={d.currentState.map((row) => [row.area, row.now, row.missing])}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Stack>
  );
}
