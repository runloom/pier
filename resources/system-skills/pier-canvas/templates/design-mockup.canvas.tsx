import { Artboard, Button, Layer, Stack, Text, WorldStage } from "pier/canvas";

/**
 * Starter for recipe=design: world-stage device frames.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Fonts: UI font only. Comments stay in host Design Mode — do not fake pins.
 * Put `data-pier-comment-id` on frames so pins survive reload.
 */
export const canvas = {
  description: "Multi-device mockup on a world stage.",
  kind: "composition" as const,
  title: "Design mockup",
};

export default function DesignMockupCanvas() {
  return (
    <WorldStage padding={40}>
      <Layer x={32} y={32}>
        <Artboard
          description="Primary settings surface."
          label="D1"
          preset="desktop"
          title="Settings"
        >
          <div className="h-full" data-pier-comment-id="desktop-settings">
            <Stack className="h-full bg-background p-6" gap={16}>
              <Text as="h2">Settings</Text>
              <Text tone="secondary">
                Replace this frame with the real product chrome.
              </Text>
              <Button type="button">Primary action</Button>
            </Stack>
          </div>
        </Artboard>
      </Layer>
      <Layer x={1360} y={32}>
        <Artboard label="P1" preset="phone" title="Home">
          <div className="h-full" data-pier-comment-id="phone-home">
            <Stack className="h-full bg-background p-5" gap={12}>
              <Text as="h2">Home</Text>
              <Text tone="secondary">
                Phone preset. Width and height you set still win.
              </Text>
              <Button type="button" variant="outline">
                Secondary
              </Button>
            </Stack>
          </div>
        </Artboard>
      </Layer>
    </WorldStage>
  );
}
