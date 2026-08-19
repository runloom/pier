import {
  Alert,
  AlertDescription,
  AlertTitle,
  Frame,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Spinner,
  Stack,
  Text,
} from "pier/canvas";
import { useHostSnapshot } from "pier/host";

/**
 * Host activity through pier/host. KPI binding lives on this page.
 * Open: `.pier/canvases/activity-overview/activity-overview.canvas.tsx`
 */
export const canvas = {
  description: "Foreground activity in this window.",
  kind: "composition" as const,
  title: "Activity overview",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countForegroundActivity(payload: unknown): {
  inProgress: number;
  needsYou: number;
  running: number;
} {
  const activities =
    isRecord(payload) && Array.isArray(payload.activities)
      ? payload.activities
      : [];
  let needsYou = 0;
  let running = 0;
  for (const row of activities) {
    if (!isRecord(row) || row.kind !== "agent") {
      continue;
    }
    if (row.status === "waiting" || row.status === "error") {
      needsYou += 1;
    } else if (row.status === "processing" || row.status === "tool") {
      running += 1;
    }
  }
  return {
    inProgress: activities.length,
    needsYou,
    running,
  };
}

export default function ActivityOverviewCanvas() {
  const snapshot = useHostSnapshot("foreground-activity");
  if (snapshot.status === "loading") {
    return (
      <Frame maxWidth={640}>
        <Stack gap={12}>
          <Spinner aria-label="Loading activity" />
          <Text tone="secondary">Loading this window’s activity…</Text>
        </Stack>
      </Frame>
    );
  }
  if (snapshot.status === "error") {
    return (
      <Frame maxWidth={640}>
        <Alert>
          <AlertTitle>Couldn’t load activity</AlertTitle>
          <AlertDescription>
            {snapshot.error ?? "Try opening this canvas again."}
          </AlertDescription>
        </Alert>
      </Frame>
    );
  }
  const data = countForegroundActivity(snapshot.data);
  return (
    <Frame maxWidth={640}>
      <Stack gap={12}>
        <Stack gap={6}>
          <Text as="h2">Foreground activity</Text>
          <Text tone="secondary">
            Live sessions, tasks, and shells in this window.
          </Text>
        </Stack>
        <ItemGroup>
          <Item>
            <ItemContent>
              <ItemTitle>Needs your attention</ItemTitle>
              <ItemDescription>{data.needsYou}</ItemDescription>
            </ItemContent>
          </Item>
          <Item>
            <ItemContent>
              <ItemTitle>Running</ItemTitle>
              <ItemDescription>{data.running}</ItemDescription>
            </ItemContent>
          </Item>
          <Item>
            <ItemContent>
              <ItemTitle>In progress</ItemTitle>
              <ItemDescription>{data.inProgress}</ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </Stack>
    </Frame>
  );
}
