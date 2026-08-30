import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DocsShell,
  Input,
  Mermaid,
  Row,
  Separator,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import { useState } from "react";

/**
 * Showcase for the reading flow: a real guide built on DocsShell.
 * The document teaches how to pick a canvas stage — so opening the reading
 * flow example is itself the lesson. Rewrite every user-visible string into
 * the user's language before delivery.
 *
 * Composition notes (this template doubles as a reference):
 * - Layout uses host DocsShell. Do not hand-roll dual ScrollArea shells.
 * - `Text` sizing/weight/color come from `as` + `tone` variants (inline
 *   styles own typography; `text-*` / `font-*` classes would be ignored).
 * - Fonts: DocsShell body/titles use the host document font; sidebar
 *   controls and live component demos keep the UI font.
 */
export const canvas = {
  description: "Guide: picking a canvas stage (reading-flow showcase).",
  kind: "docs" as const,
  title: "Canvas stages guide",
};

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "flow", label: "Reading flow" },
  { id: "world", label: "Board stage" },
  { id: "choosing", label: "Choosing" },
  { id: "next", label: "Next steps" },
] as const;

type NavId = (typeof NAV)[number]["id"];

function isNavId(id: string): id is NavId {
  return NAV.some((item) => item.id === id);
}

function SectionTitle(props: { anchorId: string; children: string }) {
  return (
    <Text as="h2" data-pier-comment-id={props.anchorId}>
      {props.children}
    </Text>
  );
}

function OverviewSection() {
  return (
    <Stack gap={12}>
      <SectionTitle anchorId="sec-overview">
        Two stages, one shell
      </SectionTitle>
      <Text>
        Every canvas renders inside the same preview shell, but the root
        primitive decides its geometry. A flow canvas scrolls like a document
        and inherits the reader's typography preferences. A world canvas locks
        the viewport and lets the reader pan and zoom over content placed on a
        plane. There is no mode switch to configure — the shell detects the
        root you exported.
      </Text>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead>Geometry</TableHead>
            <TableHead>Root</TableHead>
            <TableHead>Best for</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Reading flow</TableCell>
            <TableCell>Vertical scroll, reading measure</TableCell>
            <TableCell>
              <code>DocsShell</code> / flowing composition
            </TableCell>
            <TableCell>Guides, manuals</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Full-bleed fill</TableCell>
            <TableCell>Single screen, inner scroll</TableCell>
            <TableCell>
              <code>Stack fill</code>
            </TableCell>
            <TableCell>Dashboards, boards</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Board stage</TableCell>
            <TableCell>Camera: pan + zoom over a plane</TableCell>
            <TableCell>
              <code>WorldStage</code>
            </TableCell>
            <TableCell>Mockups, spatial layouts</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Stack>
  );
}

function FlowSection() {
  return (
    <Stack gap={12}>
      <SectionTitle anchorId="sec-flow">
        Reading flow: the document is a document
      </SectionTitle>
      <Text>
        Reach for the reading flow when people consume your canvas top to
        bottom: onboarding guides, decision records, runbooks, user manuals.
        The shell owns the column width; the reader owns the type size.
      </Text>
      <Alert>
        <AlertTitle>Typography follows the reader</AlertTitle>
        <AlertDescription>
          Body text uses the host document font, and the reader's font-size /
          comfortable-vs-wide preference applies to this article
          automatically. Try changing the reading preferences — this page
          follows without any code in the canvas.
        </AlertDescription>
      </Alert>
      <Text>
        Everything a document needs flows naturally: paragraphs, lists like
        the one below, tables, quotes, and inline <code>code</code>.
      </Text>
      <Stack gap={4}>
        <Text>· Long-form prose that benefits from a reading measure</Text>
        <Text>· Anchored comments on any section title (Design Mode pins)</Text>
        <Text>· Live component demos embedded mid-article — see below</Text>
      </Stack>
      <Stack
        className="rounded-md border border-border bg-background p-4"
        gap={8}
      >
        <Row gap={8} wrap>
          <Badge variant="secondary">Live demo</Badge>
          <Text as="span" tone="secondary">
            Controls keep the UI font while the article around them uses the
            document font — compare this label with the paragraph above.
          </Text>
        </Row>
        <Row gap={8} wrap>
          <Input aria-label="Sample field" placeholder="Type here" />
          <Button type="button">Primary</Button>
          <Button type="button" variant="outline">
            Secondary
          </Button>
        </Row>
      </Stack>
    </Stack>
  );
}

function WorldSection() {
  return (
    <Stack gap={12}>
      <SectionTitle anchorId="sec-world">
        Board stage: content on a plane
      </SectionTitle>
      <Text>
        Reach for the board stage when position carries meaning: multi-device
        design mockups, moodboards, spatial walkthroughs. Frames sit at world
        coordinates; the reader flies over them with the camera instead of
        scrolling past them.
      </Text>
      <Stack gap={4}>
        <Text>
          · Scroll or drag the background to pan; the wheel never zooms by
          itself
        </Text>
        <Text>
          · Hold <code>ctrl</code> (trackpad pinch) and scroll to zoom at the
          cursor
        </Text>
        <Text>· Double-click to jump between fit-all and 100%</Text>
      </Stack>
      <Text tone="secondary">
        Comment pins work on the board too: put a stable
        <code> data-pier-comment-id</code> on each frame so feedback survives
        reloads.
      </Text>
    </Stack>
  );
}

function ChoosingSection() {
  return (
    <Stack gap={12}>
      <SectionTitle anchorId="sec-choosing">Choosing a stage</SectionTitle>
      <Text>
        Start from what the reader does with the canvas. The diagram below is
        a static architecture sketch — exactly what <code>Mermaid</code> is
        for. It never recolors from live data.
      </Text>
      <Mermaid
        aria-label="Stage decision diagram"
        direction="left-to-right"
        edges={[
          { label: "read top-down", source: "ask", target: "flow" },
          { label: "watch one screen", source: "ask", target: "fill" },
          { label: "arrange in space", source: "ask", target: "world" },
        ]}
        nodes={[
          {
            id: "ask",
            meta: "What does the reader do?",
            title: "Content",
          },
          { id: "flow", kind: "artifact", title: "Reading flow" },
          { id: "fill", kind: "artifact", title: "Stack fill" },
          { id: "world", kind: "artifact", title: "WorldStage" },
        ]}
      />
      <Separator />
      <Text tone="secondary">
        Mixed needs? A flow document can embed fit-all cards (like the diagram
        above), and a board can carry long captions. Pick the stage that
        matches the primary journey, not every element.
      </Text>
    </Stack>
  );
}

function NextSection() {
  return (
    <Stack gap={12}>
      <SectionTitle anchorId="sec-next">Next steps</SectionTitle>
      <Text>
        The board-stage counterpart of this guide is the design-mockup
        template: three device frames of one product surface, placed on a
        world plane with a caption note beside them.
      </Text>
      <Stack gap={4}>
        <Text>
          · Board showcase: <code>templates/design-mockup.canvas.tsx</code>
        </Text>
        <Text>
          · Generate your own: run the <code>pier-canvas</code> skill and
          describe the document or board you need
        </Text>
      </Stack>
    </Stack>
  );
}

export default function DocsCanvas() {
  const [navId, setNavId] = useState<NavId>("overview");

  const header = (
    <Stack gap={8}>
      <Row gap={8} wrap>
        <Badge variant="secondary">docs</Badge>
        <Badge variant="outline">reading-flow showcase</Badge>
      </Row>
      <Text as="h1">Canvas stages: reading flow and board</Text>
      <Text tone="secondary">
        For anyone writing or requesting a canvas. After reading you can pick
        the right stage for a document, a dashboard, or a design board — and
        know why this very page is a reading-flow canvas.
      </Text>
    </Stack>
  );

  return (
    <DocsShell
      header={header}
      nav={[...NAV]}
      navId={navId}
      onNavChange={(id) => {
        if (isNavId(id)) {
          setNavId(id);
        }
      }}
    >
      {navId === "overview" ? <OverviewSection /> : null}
      {navId === "flow" ? <FlowSection /> : null}
      {navId === "world" ? <WorldSection /> : null}
      {navId === "choosing" ? <ChoosingSection /> : null}
      {navId === "next" ? <NextSection /> : null}
    </DocsShell>
  );
}
