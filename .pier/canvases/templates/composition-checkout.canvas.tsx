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
import { DemoChip } from "../shared/demo-chip";

/**
 * Design canvas (composition) — Storybook Canvas / Playroom / Figma Frame.
 * Open: `.pier/canvases/templates/composition-checkout.canvas.tsx`
 */
export const canvas = {
  description:
    "Checkout redesign frame — host kit plus a local project DemoChip.",
  kind: "composition" as const,
  title: "Checkout redesign",
};

function MoneyRow(props: { label: string; value: string; strong?: boolean }) {
  return (
    <Row justify="space-between">
      <Text
        tone={props.strong ? "default" : "secondary"}
        style={props.strong ? { fontWeight: 600 } : undefined}
      >
        {props.label}
      </Text>
      <Text style={props.strong ? { fontWeight: 600 } : undefined}>
        {props.value}
      </Text>
    </Row>
  );
}

export default function CompositionCheckoutCanvas() {
  return (
    <Frame maxWidth={960}>
      <Stack gap={8}>
        <Row justify="space-between" align="start">
          <Stack gap={6}>
            <Text as="h1">Checkout</Text>
            <Text tone="secondary" style={{ maxWidth: 480 }}>
              Redesign proposal for annual upgrade. One screen, three states on
              the right — empty, ready, and error.
            </Text>
          </Stack>
          <Row gap={8} wrap>
            <Badge variant="neutral">Desktop</Badge>
            <Badge variant="warning">Draft</Badge>
            <Badge variant="info">composition</Badge>
          </Row>
        </Row>
      </Stack>

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          overflow: "hidden",
          background: "var(--card)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--muted)",
          }}
        >
          <Row justify="space-between">
            <Text style={{ fontWeight: 600 }}>pier.app / billing</Text>
            <DemoChip label="project · DemoChip" />
          </Row>
        </div>

        <div style={{ padding: 20 }}>
          <div
            style={{
              display: "grid",
              gap: 20,
              gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
            }}
          >
            <Stack gap={16}>
              <Stack gap={8}>
                <Text as="h2">Order summary</Text>
                <Card>
                  <CardHeader>
                    <CardTitle>Pro · Annual</CardTitle>
                    <CardDescription>
                      8 seats · priority support · audit log
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Stack gap={10}>
                      <MoneyRow label="Subscription" value="$240.00" />
                      <MoneyRow label="Seat add-ons (2)" value="$48.00" />
                      <MoneyRow label="Tax (est.)" value="$23.04" />
                      <Separator />
                      <MoneyRow label="Due today" value="$311.04" strong />
                      <Row gap={8}>
                        <Button>Pay now</Button>
                        <Button variant="outline">Back to plans</Button>
                      </Row>
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>

              <Stack gap={8}>
                <Text as="h3">Payment method</Text>
                <Card size="sm">
                  <CardContent>
                    <Row justify="space-between">
                      <Stack gap={2}>
                        <Text style={{ fontWeight: 600 }}>Visa ···· 4242</Text>
                        <Text tone="secondary">Expires 08 / 28</Text>
                      </Stack>
                      <Button variant="ghost">Change</Button>
                    </Row>
                  </CardContent>
                </Card>
                <Card size="sm">
                  <CardContent>
                    <Row justify="space-between">
                      <Stack gap={2}>
                        <Text style={{ fontWeight: 600 }}>Invoice email</Text>
                        <Text tone="secondary">finance@example.com</Text>
                      </Stack>
                      <Button variant="ghost">Edit</Button>
                    </Row>
                  </CardContent>
                </Card>
              </Stack>
            </Stack>

            <Stack gap={14}>
              <Text as="h2">States</Text>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Empty</CardTitle>
                  <CardDescription>No plan selected</CardDescription>
                </CardHeader>
                <CardContent>
                  <Stack gap={10}>
                    <Text tone="secondary">
                      Choose a plan to populate the order summary.
                    </Text>
                    <Button variant="secondary">Browse plans</Button>
                  </Stack>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <Row justify="space-between">
                    <CardTitle>Ready</CardTitle>
                    <Badge variant="success" size="xs">
                      OK
                    </Badge>
                  </Row>
                  <CardDescription>Ready to charge</CardDescription>
                </CardHeader>
                <CardContent>
                  <Text tone="secondary">
                    Primary CTA enabled · tax estimated · receipt queued.
                  </Text>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <Row justify="space-between">
                    <CardTitle>Error</CardTitle>
                    <Badge variant="danger" size="xs">
                      Failed
                    </Badge>
                  </Row>
                </CardHeader>
                <CardContent>
                  <Stack gap={10}>
                    <Alert variant="destructive">
                      <Text style={{ fontWeight: 600 }}>Payment declined</Text>
                      <Text tone="secondary">
                        Bank rejected the charge. Retry or switch cards.
                      </Text>
                    </Alert>
                    <Row>
                      <Button variant="destructive">Retry payment</Button>
                      <Button variant="outline">Use another card</Button>
                    </Row>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </div>
        </div>
      </div>

      <Alert variant="info">
        <Text style={{ fontWeight: 600 }}>Composition rules</Text>
        <Text tone="secondary">
          One proposal per file · product-like regions · states side by side ·
          prefer project components for the core UI.
        </Text>
      </Alert>
    </Frame>
  );
}
