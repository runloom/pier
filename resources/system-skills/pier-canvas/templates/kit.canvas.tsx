import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Input,
  Row,
  Separator,
  Stack,
  Text,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "pier/canvas";
import { useState } from "react";

/**
 * Starter for kit: grouped components and states. Prefer real project
 * components. Rewrite every user-visible string into the user's language.
 *
 * Fonts: UI font + component tokens. Do not use the host document font.
 */
export const canvas = {
  description: "Component catalog: grouped by use, with key states and variants.",
  kind: "kit" as const,
  title: "Component catalog",
};

export default function KitCanvas() {
  const [tone, setTone] = useState("default");

  return (
    <Frame maxWidth={1040}>
      <Stack gap={20}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="success">kit</Badge>
          </Row>
          <Text as="h1">Component catalog</Text>
          <Text tone="secondary">
            Group by use. Import real design-system components instead of
            copying host source.
          </Text>
        </Stack>

        <Stack gap={10}>
          <Text as="h2">Buttons</Text>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Variants</CardTitle>
              <CardDescription>
                Default density 28px; icons use data-icon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Row gap={8} wrap>
                <Button type="button">Default</Button>
                <Button type="button" variant="outline">
                  Outline
                </Button>
                <Button type="button" variant="secondary">
                  Secondary
                </Button>
                <Button type="button" variant="destructive">
                  Destructive
                </Button>
                <Button disabled type="button">
                  Disabled
                </Button>
              </Row>
            </CardContent>
          </Card>
        </Stack>

        <Separator />

        <Stack gap={10}>
          <Text as="h2">Input and toggles</Text>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-4">
              <Row className="items-center" gap={12} wrap>
                <Input
                  className="max-w-xs"
                  placeholder="Placeholder"
                  readOnly
                  value="Example input"
                />
                <Toggle aria-label="Example toggle" type="button">
                  Toggle
                </Toggle>
              </Row>
              <ToggleGroup
                onValueChange={(value) => {
                  if (value) {
                    setTone(value);
                  }
                }}
                type="single"
                value={tone}
                variant="outline"
              >
                <ToggleGroupItem value="default">Default</ToggleGroupItem>
                <ToggleGroupItem value="quiet">Quiet</ToggleGroupItem>
                <ToggleGroupItem value="emphasis">Emphasis</ToggleGroupItem>
              </ToggleGroup>
              <Text as="span" tone="secondary">
                Current: {tone}
              </Text>
            </CardContent>
          </Card>
        </Stack>

        <Stack gap={10}>
          <Text as="h2">Status badges</Text>
          <Row gap={8} wrap>
            <Badge variant="info">Info</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="destructive">Error</Badge>
            <Badge variant="secondary">Neutral</Badge>
            <Badge variant="outline">Outline</Badge>
          </Row>
        </Stack>
      </Stack>
    </Frame>
  );
}
