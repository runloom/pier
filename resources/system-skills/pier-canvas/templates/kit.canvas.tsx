// biome-ignore lint/correctness/useImportExtensions: pier/canvas is a host virtual module
import { Badge, Card, CardContent, Frame, Stack, Text } from "pier/canvas";

export const canvas = {
  description:
    "A catalog for exploring components, states, variants, and design tokens.",
  kind: "kit" as const,
  title: "Component Kit",
};

export default function KitCanvas() {
  return (
    <Frame maxWidth={1040}>
      <Stack gap={16}>
        <Stack gap={6}>
          <Badge variant="success">kit</Badge>
          <Text as="h1">Component Kit</Text>
          <Text tone="secondary">
            Group components by purpose and show their key states and variants.
          </Text>
        </Stack>
        <Card>
          <CardContent>
            <Text>
              Import real components from the project's design system and
              present them here.
            </Text>
          </CardContent>
        </Card>
      </Stack>
    </Frame>
  );
}
