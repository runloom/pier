import {
  Artboard,
  Badge,
  Button,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Layer,
  Row,
  Stack,
  Text,
  WorldStage,
} from "pier/canvas";

export const canvas = {
  description:
    "World-stage device frames (desktop + phone). Comments stay in Design Mode.",
  kind: "composition" as const,
  title: "Design mockup",
};

function DesktopSettings() {
  return (
    <Stack className="h-full bg-background p-6" gap={20}>
      <Stack gap={6}>
        <Row gap={8} wrap>
          <Badge variant="info">desktop</Badge>
          <Badge variant="outline">1280×800</Badge>
        </Row>
        <Text as="h2">Project settings</Text>
        <Text className="text-sm" tone="secondary">
          Replace these frames with the product chrome you are reviewing.
        </Text>
      </Stack>
      <ItemGroup className="gap-2">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Preview roots</ItemTitle>
            <ItemDescription>
              Folders the files preview compiles as live modules.
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Trust</ItemTitle>
            <ItemDescription>
              First open confirms the project. Memory is not in the repo.
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <Row gap={8}>
        <Button type="button">Save</Button>
        <Button type="button" variant="outline">
          Cancel
        </Button>
      </Row>
    </Stack>
  );
}

function PhoneHome() {
  return (
    <Stack className="h-full bg-background p-5" gap={16}>
      <Row gap={8} wrap>
        <Badge variant="info">phone</Badge>
        <Badge variant="outline">393×852</Badge>
      </Row>
      <Text as="h2">Inbox</Text>
      <ItemGroup className="gap-2">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Waiting</ItemTitle>
            <ItemDescription>Two sessions waiting.</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Running</ItemTitle>
            <ItemDescription>Compile still in progress.</ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
      <Button type="button" variant="outline">
        Open activity
      </Button>
    </Stack>
  );
}

/**
 * Gold for recipe=design. Open from the files tree to get the world shell
 * (viewport lock + zoom/pan). Pin comments with Design Mode; do not fake pins.
 */
export default function DesignMockup() {
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
            <DesktopSettings />
          </div>
        </Artboard>
      </Layer>
      <Layer x={1360} y={32}>
        <Artboard label="P1" preset="phone" title="Home">
          <div className="h-full" data-pier-comment-id="phone-home">
            <PhoneHome />
          </div>
        </Artboard>
      </Layer>
    </WorldStage>
  );
}
