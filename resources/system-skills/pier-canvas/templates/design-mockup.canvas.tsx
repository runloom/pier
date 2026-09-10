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
  ScreenFlow,
  Stack,
  Text,
  WorldStage,
  type ScreenFlowSpec,
  validateScreenFlowSpec,
} from "pier/canvas";
import type { ReactNode } from "react";

/**
 * recipe=design gold: one user path across product frames on WorldStage.
 * Connectors come from ScreenFlow (same engine as recipe=workflow).
 * Keep a stable `data-pier-comment-id` on each frame. Do not fake pin chrome.
 * Do not draw SVG noodles. Call validateScreenFlowSpec; apply the first
 * supportedFix. Rewrite every user-visible string into the user's language.
 */
export const canvas = {
  description: "Upload-an-asset path on a world stage.",
  kind: "composition" as const,
  title: "Design mockup",
};

const ASSETS = [
  { kind: "Photo", name: "Harbor at dusk", size: "4.2 MB" },
  { kind: "Photo", name: "Studio portrait", size: "3.1 MB" },
  { kind: "Illustration", name: "Onboarding hero", size: "820 KB" },
] as const;

const spec: ScreenFlowSpec = {
  edges: [
    { from: "library", id: "e-open", label: "Tap asset", to: "detail" },
    { from: "detail", id: "e-upload", label: "Tap Upload", to: "confirm" },
    { from: "confirm", id: "e-send", label: "Confirm", to: "success" },
    {
      from: "confirm",
      id: "e-fail",
      label: "Validation failed",
      role: "error",
      to: "blocked",
    },
    {
      from: "blocked",
      id: "e-retry",
      label: "Fix file",
      role: "return",
      to: "confirm",
    },
  ],
  mainPath: ["library", "detail", "confirm", "success"],
  start: "library",
  title: "Upload an asset",
};

validateScreenFlowSpec(spec);

function PhoneChrome(props: {
  badge: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <Stack className="h-full bg-background p-4" gap={12}>
      <Row justify="space-between">
        <Text as="h3">{props.title}</Text>
        <Badge variant="secondary">{props.badge}</Badge>
      </Row>
      {props.children}
    </Stack>
  );
}

function LibraryPhone() {
  return (
    <div className="h-full" data-pier-comment-id="library-phone">
      <PhoneChrome badge="3" title="Library">
        <ItemGroup>
          {ASSETS.map((asset) => (
            <Item key={asset.name} size="sm">
              <div
                aria-hidden="true"
                className="size-9 shrink-0 rounded-sm bg-muted"
              />
              <ItemContent>
                <ItemTitle>{asset.name}</ItemTitle>
                <ItemDescription>
                  {asset.kind} · {asset.size}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
        <Button className="w-full" type="button">
          Upload
        </Button>
      </PhoneChrome>
    </div>
  );
}

function DetailPhone() {
  const asset = ASSETS[0];
  return (
    <div className="h-full" data-pier-comment-id="library-detail">
      <PhoneChrome badge={asset.kind} title={asset.name}>
        <div
          aria-hidden="true"
          className="h-48 w-full rounded-md bg-muted"
        />
        <Text tone="secondary">{asset.size} · ready to upload</Text>
        <Button className="w-full" type="button">
          Upload
        </Button>
      </PhoneChrome>
    </div>
  );
}

function ConfirmPhone() {
  return (
    <div className="h-full" data-pier-comment-id="library-confirm">
      <PhoneChrome badge="Review" title="Confirm upload">
        <Stack className="rounded-md border border-border p-3" gap={6}>
          <Text>{ASSETS[0].name}</Text>
          <Text tone="secondary">Library / Photos · {ASSETS[0].size}</Text>
        </Stack>
        <Row gap={8}>
          <Button className="flex-1" type="button" variant="outline">
            Cancel
          </Button>
          <Button className="flex-1" type="button">
            Confirm
          </Button>
        </Row>
      </PhoneChrome>
    </div>
  );
}

function SuccessPhone() {
  return (
    <div className="h-full" data-pier-comment-id="library-success">
      <PhoneChrome badge="Done" title="Uploaded">
        <Stack className="items-start" gap={8}>
          <Text>Harbor at dusk is in the library.</Text>
          <Button type="button" variant="outline">
            Back to library
          </Button>
        </Stack>
      </PhoneChrome>
    </div>
  );
}

function BlockedPhone() {
  return (
    <div className="h-full" data-pier-comment-id="library-blocked">
      <PhoneChrome badge="Needs you" title="Couldn’t upload">
        <Stack className="rounded-md border border-border p-3" gap={6}>
          <Text>File type isn’t allowed.</Text>
          <Text tone="secondary">Choose a photo or illustration and retry.</Text>
        </Stack>
        <Button className="w-full" type="button">
          Fix file
        </Button>
      </PhoneChrome>
    </div>
  );
}

function CaptionNote() {
  return (
    <div className="flex w-[560px] flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
      <Row gap={8}>
        <Badge variant="secondary">Note</Badge>
        <Text as="h3">One path, five frames</Text>
      </Row>
      <Text tone="secondary">
        A guest opens an asset, confirms upload, and lands on success. Validation
        failure drops to the row below and returns on the opposite side of the
        frame. Main-path connectors are solid; exception edges use color and
        weight, not dashes. The reading-flow counterpart lives in
        templates/docs.canvas.tsx.
      </Text>
    </div>
  );
}

export default function DesignMockupCanvas() {
  return (
    <WorldStage padding={40}>
      <Layer x={40} y={40}>
        <Artboard
          description="Browse the library, then open one asset."
          height={560}
          id="library"
          label="S1"
          preset="phone"
          title="Library"
        >
          <LibraryPhone />
        </Artboard>
      </Layer>
      <Layer x={641} y={40}>
        <Artboard
          description="Same asset, ready to upload."
          height={560}
          id="detail"
          label="S2"
          preset="phone"
          title="Asset"
        >
          <DetailPhone />
        </Artboard>
      </Layer>
      <Layer x={1234} y={40}>
        <Artboard
          description="Confirm destination and send."
          height={560}
          id="confirm"
          label="S3"
          preset="phone"
          title="Confirm"
        >
          <ConfirmPhone />
        </Artboard>
      </Layer>
      <Layer x={1827} y={40}>
        <Artboard
          description="Upload finished."
          height={560}
          id="success"
          label="S4"
          preset="phone"
          title="Done"
        >
          <SuccessPhone />
        </Artboard>
      </Layer>
      <Layer x={1234} y={820}>
        <Artboard
          description="Needs you: file type rejected."
          height={560}
          id="blocked"
          label="S3b"
          preset="phone"
          title="Needs you"
        >
          <BlockedPhone />
        </Artboard>
      </Layer>
      <Layer x={40} y={820}>
        <CaptionNote />
      </Layer>
      <ScreenFlow spec={spec} />
    </WorldStage>
  );
}
