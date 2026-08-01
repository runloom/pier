// biome-ignore lint/correctness/useImportExtensions: pier/canvas is a host virtual module
import { Badge, Card, CardContent, Frame, Stack, Text } from "pier/canvas";

export const canvas = {
  description:
    "An interactive composition for explaining relationships, flows, data, or options.",
  kind: "composition" as const,
  title: "Solution Canvas",
};

export default function CompositionCanvas() {
  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={6}>
          <Badge variant="info">composition</Badge>
          <Text as="h1">Solution Canvas</Text>
          <Text tone="secondary">
            Lead with the key conclusion, then develop the evidence and
            relationships.
          </Text>
        </Stack>
        <Card>
          <CardContent>
            <Text>
              Replace this with a chart, flow, or interaction suited to the
              task.
            </Text>
          </CardContent>
        </Card>
      </Stack>
    </Frame>
  );
}
