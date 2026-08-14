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
 * Starter for composition: conclusion → evidence → relationship diagram.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Fonts: UI font and component defaults. Do not apply the host document font
 * (design frames should look like product UI, not long-form reading).
 */
export const canvas = {
  description: "Proposal composition: conclusion first, with a diagram and options.",
  kind: "composition" as const,
  title: "Proposal canvas",
};

export default function CompositionCanvas() {
  return (
    <Frame maxWidth={960}>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">composition</Badge>
            <Badge variant="outline">Example</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            Proposal title
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            One sentence on the problem and the takeaway the reader should leave
            with.
          </Text>
        </Stack>

        <Card className="border-status-info/30 bg-status-info/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conclusion</CardTitle>
            <CardDescription>Answer first, reasons second.</CardDescription>
          </CardHeader>
          <CardContent>
            <Text className="text-sm leading-relaxed">
              Write the trade-off: what we will do, what we will not, and why
              now.
            </Text>
          </CardContent>
        </Card>

        <Stack gap={8}>
          <Text className="text-sm font-medium">Critical path</Text>
          <MermaidDiagram
            aria-label="Example flow"
            source={`flowchart LR
  A[Input] --> B[Process]
  B --> C[Output]
  B --> D[Error]
  D --> B`}
          />
        </Stack>

        <Separator />

        <Stack gap={8}>
          <Text className="text-sm font-medium">Options</Text>
          <ItemGroup className="gap-2">
            <Item variant="outline" className="px-3 py-2">
              <ItemContent>
                <ItemTitle>Option A (recommended)</ItemTitle>
                <ItemDescription>
                  Benefit and cost. Suitable as the default main path.
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="outline" className="px-3 py-2">
              <ItemContent>
                <ItemTitle>Option B</ItemTitle>
                <ItemDescription>
                  Why not: complexity, risk, or a product-boundary conflict.
                </ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </Stack>
      </Stack>
    </Frame>
  );
}
