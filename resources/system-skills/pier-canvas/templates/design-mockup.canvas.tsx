import {
  Artboard,
  Badge,
  Button,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Layer,
  Row,
  Separator,
  Stack,
  Text,
  WorldStage,
} from "pier/canvas";

/**
 * Showcase for the board stage: one product surface ("Library") mocked at
 * three device sizes on a world plane, plus a caption note in world space.
 * The responsive differences between frames are the design story.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Composition notes (this template doubles as a reference):
 * - `Text` sizing/weight/color come from `as` + `tone` variants (inline
 *   styles own typography; `text-*` / `font-*` classes would be ignored).
 * - `Stack` / `Row` stretch to 100% width. Fixed-width blocks (sidebar,
 *   caption) use a plain flex `div` so `w-*` classes apply.
 * - `Row` alignment comes from the `align` / `justify` / `wrap` props.
 *
 * Fonts: UI font only — design frames must look like product UI.
 * Comments stay in host Design Mode: keep a stable `data-pier-comment-id`
 * on each frame so whole-frame pins survive reload. Inner controls stay
 * pickable; do not fake pin chrome.
 */
export const canvas = {
  description: "Multi-device Library mockup on a world stage.",
  kind: "composition" as const,
  title: "Design mockup",
};

const SECTIONS = ["All assets", "Photos", "Illustrations", "Archive"] as const;

const ASSETS = [
  { kind: "Photo", name: "Harbor at dusk", size: "4.2 MB", swatch: "muted" },
  {
    kind: "Photo",
    name: "Studio portrait",
    size: "3.1 MB",
    swatch: "accent",
  },
  {
    kind: "Illustration",
    name: "Onboarding hero",
    size: "820 KB",
    swatch: "secondary",
  },
  {
    kind: "Illustration",
    name: "Empty-state set",
    size: "640 KB",
    swatch: "muted",
  },
  { kind: "Photo", name: "Team offsite", size: "5.8 MB", swatch: "accent" },
  {
    kind: "Icon set",
    name: "Navigation glyphs",
    size: "96 KB",
    swatch: "secondary",
  },
] as const;

type Asset = (typeof ASSETS)[number];
type Swatch = Asset["swatch"];

const CARD_SWATCH: Record<Swatch, string> = {
  accent: "h-24 w-full rounded-sm bg-accent",
  muted: "h-24 w-full rounded-sm bg-muted",
  secondary: "h-24 w-full rounded-sm bg-secondary",
};

const THUMB_SWATCH: Record<Swatch, string> = {
  accent: "size-9 shrink-0 rounded-sm bg-accent",
  muted: "size-9 shrink-0 rounded-sm bg-muted",
  secondary: "size-9 shrink-0 rounded-sm bg-secondary",
};

function AssetCard(props: { asset: Asset }) {
  return (
    <Stack className="rounded-md border border-border bg-card p-3" gap={8}>
      <div
        aria-hidden="true"
        className={CARD_SWATCH[props.asset.swatch]}
      />
      <Stack gap={2}>
        <Text className="truncate">{props.asset.name}</Text>
        <Row justify="space-between">
          <Badge variant="outline">{props.asset.kind}</Badge>
          <Text as="span" tone="tertiary">
            {props.asset.size}
          </Text>
        </Row>
      </Stack>
    </Stack>
  );
}

function LibrarySidebar() {
  return (
    <div className="flex w-48 shrink-0 flex-col gap-3 border-border border-r pr-4">
      <Text as="h3">Library</Text>
      <Stack gap={2}>
        {SECTIONS.map((section, index) => (
          <Button
            className="w-full justify-start"
            key={section}
            type="button"
            variant={index === 0 ? "secondary" : "ghost"}
          >
            {section}
          </Button>
        ))}
      </Stack>
      <Separator />
      <Text as="span" tone="tertiary">
        6 assets · 14.6 MB used
      </Text>
    </div>
  );
}

function LibraryToolbar(props: { compact?: boolean }) {
  return (
    <Row gap={8} wrap={false}>
      <Input
        aria-label="Search assets"
        className="flex-1"
        placeholder="Search assets"
      />
      {props.compact ? null : (
        <Button type="button" variant="outline">
          Filter
        </Button>
      )}
      <Button type="button">Upload</Button>
    </Row>
  );
}

function DesktopLibrary() {
  return (
    <div className="h-full" data-pier-comment-id="library-desktop">
      <Row
        align="stretch"
        className="h-full bg-background p-6"
        gap={24}
        wrap={false}
      >
        <LibrarySidebar />
        <Stack className="min-w-0 flex-1" gap={16}>
          <LibraryToolbar />
          <div className="grid grid-cols-3 gap-4">
            {ASSETS.map((asset) => (
              <AssetCard asset={asset} key={asset.name} />
            ))}
          </div>
        </Stack>
      </Row>
    </div>
  );
}

function TabletLibrary() {
  return (
    <div className="h-full" data-pier-comment-id="library-tablet">
      <Stack className="h-full bg-background p-5" gap={14}>
        <Row justify="space-between">
          <Text as="h3">Library</Text>
          <Badge variant="outline">All assets</Badge>
        </Row>
        <LibraryToolbar />
        <div className="grid grid-cols-2 gap-4">
          {ASSETS.slice(0, 4).map((asset) => (
            <AssetCard asset={asset} key={asset.name} />
          ))}
        </div>
      </Stack>
    </div>
  );
}

function PhoneLibrary() {
  return (
    <div className="h-full" data-pier-comment-id="library-phone">
      <Stack className="h-full bg-background p-4" gap={12}>
        <Row justify="space-between">
          <Text as="h3">Library</Text>
          <Badge variant="secondary">6</Badge>
        </Row>
        <LibraryToolbar compact />
        <ItemGroup>
          {ASSETS.map((asset) => (
            <Item key={asset.name} size="sm">
              <div
                aria-hidden="true"
                className={THUMB_SWATCH[asset.swatch]}
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
      </Stack>
    </div>
  );
}

function CaptionNote() {
  return (
    <div className="flex w-[560px] flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
      <Row gap={8}>
        <Badge variant="secondary">Note</Badge>
        <Text as="h3">One surface, three widths</Text>
      </Row>
      <Text tone="secondary">
        Desktop keeps the sidebar and a three-column grid; tablet drops the
        sidebar for two columns; phone becomes a single list with the same
        data. Pan with the wheel, zoom with ctrl+wheel, double-click to fit.
        The reading-flow counterpart of this board lives in
        templates/docs.canvas.tsx.
      </Text>
    </div>
  );
}

export default function DesignMockupCanvas() {
  return (
    <WorldStage padding={40}>
      <Layer x={32} y={32}>
        <Artboard
          description="Sidebar plus three-column asset grid."
          label="D1"
          preset="desktop"
          title="Library — Desktop"
        >
          <DesktopLibrary />
        </Artboard>
      </Layer>
      <Layer x={1400} y={32}>
        <Artboard
          description="Single-column list, same data."
          label="P1"
          preset="phone"
          title="Library — Phone"
        >
          <PhoneLibrary />
        </Artboard>
      </Layer>
      <Layer x={1880} y={32}>
        <Artboard
          description="Two-column middle ground."
          label="T1"
          preset="tablet"
          title="Library — Tablet"
        >
          <TabletLibrary />
        </Artboard>
      </Layer>
      <Layer x={32} y={920}>
        <CaptionNote />
      </Layer>
    </WorldStage>
  );
}
