import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MermaidDiagram,
  Row,
  Separator,
  Stack,
  Text,
} from "pier/canvas";

/**
 * composition 起手稿：结论 → 证据 → 关系图。
 * 替换标题/要点/图源即可成方案说明页。
 *
 * 字体：使用界面字体与组件默认字；不要套宿主「文档字体」或自定义阅读字
 * （设计稿应保留产品字貌，不是长文阅读流）。
 */
export const canvas = {
  description: "方案构图：结论先行，配合关系图与选项对照。",
  kind: "composition" as const,
  title: "方案画布",
};

export default function CompositionCanvas() {
  return (
    <Frame maxWidth={960}>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">composition</Badge>
            <Badge variant="outline">示例</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            方案标题
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            用一句话写清要解决的问题，以及读者读完应带走的结论。
          </Text>
        </Stack>

        <Card className="border-status-info/30 bg-status-info/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">结论</CardTitle>
            <CardDescription>先给答案，再展开理由。</CardDescription>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              在此写入最终取舍：做什么、不做什么、为何现在做。
            </Text>
          </CardContent>
        </Card>

        <Stack gap={8}>
          <Text className="text-sm font-medium">关键路径</Text>
          <MermaidDiagram
            aria-label="示例流程"
            source={`flowchart LR
  A[输入] --> B[处理]
  B --> C[输出]
  B --> D[异常]
  D --> B`}
          />
        </Stack>

        <Separator />

        <Stack gap={8}>
          <Text className="text-sm font-medium">选项对照</Text>
          <ItemGroup className="gap-2">
            <Item variant="outline" className="px-3 py-2">
              <ItemContent>
                <ItemTitle>方案 A（推荐）</ItemTitle>
                <ItemDescription>
                  写清收益与代价。适合作为默认主路径。
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="outline" className="px-3 py-2">
              <ItemContent>
                <ItemTitle>方案 B</ItemTitle>
                <ItemDescription>
                  写清为何不选：复杂度、风险或与产品边界冲突。
                </ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </Stack>
      </Stack>
    </Frame>
  );
}
