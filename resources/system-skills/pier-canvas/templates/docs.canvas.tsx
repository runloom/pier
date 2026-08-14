import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  DocsShell,
  Row,
  Stack,
  Text,
} from "pier/canvas";
import { useState } from "react";

/**
 * Starter for docs: DocsShell (left nav + article) plus sections.
 * Rewrite every user-visible string into the user's language before delivery.
 *
 * Layout uses host DocsShell. Do not hand-roll dual ScrollArea shells.
 *
 * Fonts: DocsShell body/titles use the host document font; sidebar controls
 * and live component demos keep the UI font.
 */
export const canvas = {
  description: "Guide: DocsShell section nav plus article.",
  kind: "docs" as const,
  title: "Guide",
};

const NAV = [
  { id: "intro", label: "Intro" },
  { id: "when", label: "When to use" },
  { id: "steps", label: "Steps" },
] as const;

type NavId = (typeof NAV)[number]["id"];

export default function DocsCanvas() {
  const [navId, setNavId] = useState<NavId>("intro");

  const header = (
    <Stack gap={8}>
      <Row gap={8} wrap>
        <Badge variant="secondary">docs</Badge>
      </Row>
      <Text as="h1" className="text-2xl font-semibold tracking-tight">
        Document title
      </Text>
      <Text tone="secondary" className="text-sm leading-relaxed">
        Who the reader is and what they can finish after reading. Avoid a dump
        of implementation detail.
      </Text>
    </Stack>
  );

  return (
    <DocsShell
      header={header}
      nav={[...NAV]}
      navId={navId}
      onNavChange={(id) => {
        if (id === "intro" || id === "when" || id === "steps") {
          setNavId(id);
        }
      }}
    >
      {navId === "intro" ? (
        <Stack gap={12}>
          <Text as="h2" className="text-base font-semibold">
            Intro
          </Text>
          <Alert>
            <AlertTitle>Read this first</AlertTitle>
            <AlertDescription>
              Two or three sentences on prerequisites and bounds. Later steps
              may not make sense without this context.
            </AlertDescription>
          </Alert>
        </Stack>
      ) : null}
      {navId === "when" ? (
        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            When to use
          </Text>
          <Text className="text-sm leading-relaxed">· Good for: …</Text>
          <Text className="text-sm leading-relaxed">· Not for: …</Text>
        </Stack>
      ) : null}
      {navId === "steps" ? (
        <Stack gap={8}>
          <Text as="h2" className="text-base font-semibold">
            Steps
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            Inventory content belongs in one expandable list. Mark only items
            that are not done yet. Do not ship a table plus a second Accordion
            of the same list.
          </Text>
        </Stack>
      ) : null}
    </DocsShell>
  );
}
