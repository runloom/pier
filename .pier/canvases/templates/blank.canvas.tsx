import { Badge, Button, Frame, Stack, Text } from "pier/canvas";

/**
 * Minimal React composition scaffold for AI / human drafts.
 * Open: `.pier/canvases/templates/blank.canvas.tsx`
 *
 * Engineering smoke lives in `../smoke/`. Design-time plans live in `.pier/plans/`.
 */
export const canvas = {
  description: "Blank composition scaffold — pier/canvas only.",
  kind: "composition" as const,
  title: "Blank",
};

export default function BlankCanvas() {
  return (
    <Frame maxWidth={560}>
      <Stack gap={12}>
        <Stack gap={6}>
          <Text as="h1">Blank canvas</Text>
          <Text tone="secondary">
            Replace this scaffold with a product-shaped composition. Import
            project components via relative paths or the preview barrel when
            available.
          </Text>
        </Stack>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Badge variant="neutral">pier/canvas</Badge>
          <Badge variant="info">composition</Badge>
        </div>
        <Button type="button" variant="outline">
          Primary action
        </Button>
      </Stack>
    </Frame>
  );
}
