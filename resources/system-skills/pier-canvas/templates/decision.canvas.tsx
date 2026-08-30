import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Frame,
  Row,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "pier/canvas";
import { useState } from "react";

/**
 * Starter for methodology / decision_nav_4 (design-doc default):
 * overview → problem → design → landing. No Day-1 tab.
 * Rewrite every user-visible string into the user's language before delivery.
 */
export const canvas = {
  description:
    "Design-decision overview: conclusion first, four sections, static figures and tables. No Day-1 command page.",
  kind: "composition" as const,
  title: "Design overview",
};

function H2({ children }: { children: string }) {
  return <Text as="h2">{children}</Text>;
}

export default function DecisionCanvasTemplate() {
  const [tab, setTab] = useState("overview");

  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">Product design</Badge>
            <Badge variant="outline">decision_nav_4</Badge>
          </Row>
          <Text as="h1">Proposal title</Text>
          <Text tone="secondary">One sentence: what decision this is.</Text>
        </Stack>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="problem">Problem</TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="landing">Landing</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="overview">
            <Stack gap={14}>
              <Card className="border-status-info/40 bg-status-info/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Decision (BLUF)</CardTitle>
                  <CardDescription>
                    What we will do, what we will not, and the default path.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Text>
                    Write the conclusion here. Do not put migration phases or
                    acceptance tables on this page.
                  </Text>
                </CardContent>
              </Card>
              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="destructive">Problem</Badge>
                    <CardTitle className="mt-2 text-base">Pain summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text>
                      Where the user gets stuck.
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="info">Design</Badge>
                    <CardTitle className="mt-2 text-base">Key mechanism</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text>
                      Layers / boundaries in a short phrase each.
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="success">Landing</Badge>
                    <CardTitle className="mt-2 text-base">Next step</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text>
                      What to change first (not a command recipe).
                    </Text>
                  </CardContent>
                </Card>
              </div>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="problem">
            <Stack gap={14}>
              <H2>Problem</H2>
              <Text>
                Two to four recognizable failure paths. Do not start with a
                backlog.
              </Text>
              <Stack gap={4}>
                <H2>Out of scope</H2>
                <Text>· Non-goal one</Text>
                <Text>· Non-goal two</Text>
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="design">
            <Stack gap={14}>
              <H2>Design</H2>
              <Text>
                Layers, surfaces, data boundaries. Product frames go here — not
                Day-1 command tables.
              </Text>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Option</TableHead>
                    <TableHead>Disposition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm">Option A</TableCell>
                    <TableCell className="text-sm">
                      Reject reason or adopt
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="landing">
            <Stack gap={14}>
              <H2>Landing</H2>
              <Text>
                Phases, acceptance, risks, open questions. Implementation DAGs
                belong only on this page.
              </Text>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
