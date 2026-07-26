import { Badge, Frame, Stack, Text } from "pier/canvas";

/**
 * Smoke-only canvas. Thin scaffolds: templates/blank.canvas.tsx.
 * Design-time plan dogfood: .pier/plans/.../plan.canvas.tsx.
 * Open: `.pier/canvases/smoke/hello.canvas.tsx`
 */
export const canvas = {
  description: "Minimal smoke — not a product template.",
  kind: "composition" as const,
  title: "Hello smoke",
};

export default function HelloCanvas() {
  return (
    <Frame maxWidth={520}>
      <Stack gap={10}>
        <Text as="h2">Smoke</Text>
        <Text tone="secondary">
          Pipeline ok. Scaffold: templates/blank.canvas.tsx. Plan dogfood (multi-file
          + tabs): .pier/plans/canvas-capabilities-v1/plan.canvas.tsx.
        </Text>
        <Badge variant="neutral">smoke only</Badge>
      </Stack>
    </Frame>
  );
}
