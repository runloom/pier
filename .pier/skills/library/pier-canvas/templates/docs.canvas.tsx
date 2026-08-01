// biome-ignore lint/correctness/useImportExtensions: pier/canvas is a host virtual module
import { Badge, Card, CardContent, Frame, Stack, Text } from "pier/canvas";

export const canvas = {
  description:
    "Visual documentation for explaining a concept, module, or workflow.",
  kind: "docs" as const,
  title: "Documentation Canvas",
};

export default function DocsCanvas() {
  return (
    <Frame maxWidth={800}>
      <Stack gap={16}>
        <Stack gap={6}>
          <Badge variant="neutral">docs</Badge>
          <Text as="h1">Documentation Canvas</Text>
          <Text tone="secondary">
            Organize sections and examples around the reader's goal.
          </Text>
        </Stack>
        <Card>
          <CardContent>
            <Stack gap={8}>
              <Text as="h2">What should the reader know first?</Text>
              <Text>
                Replace this with actionable guidance, examples, and next steps.
              </Text>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Frame>
  );
}
