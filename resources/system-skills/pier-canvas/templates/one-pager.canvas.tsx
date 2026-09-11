import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Mermaid,
  Frame,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Row,
  Separator,
  Stack,
  Text,
} from "pier/canvas";

/**
 * one_pager: conclusion → evidence → one diagram. No tabs.
 * Approval / recover loops use recipe=workflow, not Mermaid.
 * Rewrite every user-visible string into the user's language.
 */
export const canvas = {
  description: "Proposal composition: conclusion first, with a diagram and options.",
  kind: "composition" as const,
  title: "Proposal canvas",
};

export default function OnePagerCanvas() {
  return (
    <Frame>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">composition</Badge>
            <Badge variant="outline">Example</Badge>
          </Row>
          <Text as="h1">Proposal title</Text>
          <Text tone="secondary">
            One sentence on the problem and the takeaway the reader should leave
            with.
          </Text>
        </Stack>

        <Card className="border-status-info/40 bg-status-info/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conclusion</CardTitle>
            <CardDescription>Answer first, reasons second.</CardDescription>
          </CardHeader>
          <CardContent>
            <Text>
              Write the trade-off: what we will do, what we will not, and why
              now.
            </Text>
          </CardContent>
        </Card>

        <Stack gap={8}>
          <Text as="h2">Architecture</Text>
          <Text tone="secondary">
            Mermaid is for static architecture and sequence. Approval and
            recover loops belong on <code>recipe=workflow</code>.
          </Text>
          <Mermaid
            aria-label="Example architecture"
            direction="left-to-right"
            edges={[
              { label: "writes spec", source: "author", target: "file" },
              { label: "compile", source: "file", target: "host" },
              { label: "preview", source: "host", target: "board" },
            ]}
            nodes={[
              { id: "author", kind: "actor", title: "Author" },
              { id: "file", kind: "artifact", title: "Canvas file" },
              { id: "host", kind: "tool", title: "Canvas host" },
              { id: "board", kind: "artifact", title: "Preview" },
            ]}
          />
        </Stack>

        <Separator />

        <Stack gap={8}>
          <Text as="h2">Options</Text>
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
