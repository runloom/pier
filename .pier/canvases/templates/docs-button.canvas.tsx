import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Row,
  Separator,
  Stack,
  Text,
} from "pier/canvas";

/**
 * Visual docs — Storybook Docs analogue.
 * Open: `.pier/canvases/templates/docs-button.canvas.tsx`
 */
export const canvas = {
  description: "Button usage guide with live examples — not an app screen.",
  kind: "docs" as const,
  title: "Button · usage",
};

function Rule(props: { title: string; body: string }) {
  return (
    <Stack gap={4}>
      <Text style={{ fontWeight: 600 }}>{props.title}</Text>
      <Text tone="secondary">{props.body}</Text>
    </Stack>
  );
}

function MatrixRow(props: {
  variant: string;
  when: string;
  sample: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "120px 1fr auto",
        alignItems: "center",
        paddingBlock: 10,
      }}
    >
      <Text style={{ fontWeight: 600 }}>{props.variant}</Text>
      <Text tone="secondary">{props.when}</Text>
      {props.sample}
    </div>
  );
}

export default function DocsButtonCanvas() {
  return (
    <Frame>
      <Stack gap={10}>
        <Row gap={8} align="center">
          <Text as="h1">Button</Text>
          <Badge variant="success">docs</Badge>
          <Badge variant="neutral">pier/canvas</Badge>
        </Row>
        <Text tone="secondary" style={{ maxWidth: 560 }}>
          Buttons advance a task. This page teaches when to pick each variant.
          For the full kit matrix open templates/kit.canvas.tsx; for screen
          proposals use a composition canvas.
        </Text>
      </Stack>

      <Separator />

      <Stack gap={12}>
        <Text as="h2">When to use</Text>
        <Rule
          title="Primary"
          body="The single forward action in a view — Save, Pay, Continue, Create."
        />
        <Rule
          title="Outline / secondary"
          body="Safe exits and alternate paths — Cancel, Back, View details."
        />
        <Rule
          title="Ghost"
          body="Low-emphasis actions in dense chrome — overflow menus, inline Edit."
        />
        <Rule
          title="Destructive"
          body="Only after an explicit confirm path — Delete, Revoke, Remove."
        />
      </Stack>

      <Stack gap={12}>
        <Text as="h2">When not to use</Text>
        <Alert variant="warning">
          <Text style={{ fontWeight: 600 }}>Don&apos;t replace navigation</Text>
          <Text tone="secondary">
            Moving between sections belongs to tabs, sidebars, or links — not a
            row of primary buttons.
          </Text>
        </Alert>
        <Alert variant="warning">
          <Text style={{ fontWeight: 600 }}>
            Don&apos;t ship three accent buttons
          </Text>
          <Text tone="secondary">
            Competing primaries flatten hierarchy. Keep one accent control per
            region.
          </Text>
        </Alert>
      </Stack>

      <Stack gap={10}>
        <Text as="h2">Variant matrix</Text>
        <Card>
          <CardContent>
            <Stack gap={0}>
              <MatrixRow
                variant="default"
                when="Main forward path"
                sample={<Button>Save changes</Button>}
              />
              <Separator />
              <MatrixRow
                variant="outline"
                when="Dismiss / back"
                sample={<Button variant="outline">Cancel</Button>}
              />
              <Separator />
              <MatrixRow
                variant="secondary"
                when="Alternate positive"
                sample={<Button variant="secondary">Save draft</Button>}
              />
              <Separator />
              <MatrixRow
                variant="ghost"
                when="Inline / toolbar"
                sample={<Button variant="ghost">Edit</Button>}
              />
              <Separator />
              <MatrixRow
                variant="destructive"
                when="Confirmed destroy"
                sample={<Button variant="destructive">Delete</Button>}
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Stack gap={10}>
        <Text as="h2">Live footer pattern</Text>
        <Card>
          <CardHeader>
            <CardTitle>Dialog footer</CardTitle>
            <CardDescription>
              Cancel left-clustered as outline; primary farthest right.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Row justify="flex-end" gap={8}>
              <Button variant="outline">Cancel</Button>
              <Button>Confirm</Button>
            </Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Destructive confirm</CardTitle>
            <CardDescription>
              Danger on the confirm control only; cancel stays outline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Row justify="flex-end" gap={8}>
              <Button variant="outline">Cancel</Button>
              <Button variant="destructive">Delete project</Button>
            </Row>
          </CardContent>
        </Card>
      </Stack>

      <Stack gap={10}>
        <Text as="h2">Do / Don&apos;t</Text>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          <Alert variant="info">
            <Text style={{ fontWeight: 600 }}>Do</Text>
            <Text tone="secondary">
              Label with the user outcome (“Pay $311”) instead of a vague “OK”.
            </Text>
          </Alert>
          <Alert variant="destructive">
            <Text style={{ fontWeight: 600 }}>Don&apos;t</Text>
            <Text tone="secondary">
              Disable the primary with no explanation — show why with an Alert.
            </Text>
          </Alert>
        </div>
      </Stack>

      <Alert variant="info">
        <Text style={{ fontWeight: 600 }}>Related</Text>
        <Text tone="secondary">
          Kit catalog → templates/kit.canvas.tsx · Screen proposal →
          templates/composition-checkout.canvas.tsx
        </Text>
      </Alert>
    </Frame>
  );
}
