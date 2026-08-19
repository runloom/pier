import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Mermaid,
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
 * Starter for methodology / primary_nav_5 (closed-loop):
 * overview → problem → design → path (Day 1) → landing.
 *
 * - Default static expression (see references/methodology.md Expression selection)
 * - Bind adjacent data.json (useCanvasFile); do not add Play/Step chrome
 * - Rewrite every user-visible string into the user's language before delivery
 */
export const canvas = {
  description:
    "Closed-loop overview: conclusion first, five sections including a Day-1 recipe, static figures and tables. No required interactive demo.",
  kind: "composition" as const,
  title: "Proposal overview",
};

function H2({ children }: { children: string }) {
  return (
    <Text as="h2" className="text-base font-medium tracking-tight">
      {children}
    </Text>
  );
}

export default function OverviewCanvasTemplate() {
  const [tab, setTab] = useState("overview");

  return (
    <Frame maxWidth={960}>
      <Stack gap={16}>
        <Stack gap={8}>
          <Row gap={8} wrap>
            <Badge variant="info">Product design</Badge>
            <Badge variant="outline">primary_nav_5</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            Proposal title
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            Subtitle: one sentence on which system and which decision.
          </Text>
        </Stack>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="problem">Problem</TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="path">Day 1</TabsTrigger>
            <TabsTrigger value="landing">Landing</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="overview">
            <Stack gap={14}>
              <Card className="border-status-info/30 bg-status-info/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Insight</CardTitle>
                  <CardDescription>
                    Why it has to work this way (mechanism, not a feature list).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Text className="text-sm leading-relaxed">
                    Write the insight: layers, source of truth, default
                    encapsulation — the hidden trade-offs.
                  </Text>
                </CardContent>
              </Card>

              <Card className="border-status-info/30 bg-status-info/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Decision (BLUF)</CardTitle>
                  <CardDescription>
                    What we will do, what we will not, and the default path.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Text className="text-sm leading-relaxed">
                    Write the decision: for example teach only four commands,
                    default wait-until-settled, never treat quiet as done.
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
                    <Text className="text-sm leading-relaxed">
                      Where the user gets stuck today (one sentence).
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="info">Design</Badge>
                    <CardTitle className="mt-2 text-base">Key mechanism</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      Layers / state exits / identity — one phrase each.
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="success">Shape</Badge>
                    <CardTitle className="mt-2 text-base">Default path</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      How a user finishes one loop on Day 1.
                    </Text>
                  </CardContent>
                </Card>
              </div>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="problem">
            <Stack gap={14}>
              <H2>Problem</H2>
              <Text className="text-sm leading-relaxed">
                Two to four recognizable failure paths. Do not start with a
                backlog.
              </Text>
              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P1</Badge>
                    <CardTitle className="mt-2 text-base">Pain one</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      Symptom + wrong attribution (for example a bad done
                      signal).
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P2</Badge>
                    <CardTitle className="mt-2 text-base">Pain two</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      Symptom + cost (steep learning, glue scripts).
                    </Text>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <Badge variant="outline">P3</Badge>
                    <CardTitle className="mt-2 text-base">Pain three</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      Symptom + risk (false hits, invisible stalls).
                    </Text>
                  </CardContent>
                </Card>
              </div>
              <Stack gap={4}>
                <H2>Out of scope</H2>
                <Text className="text-sm leading-relaxed">
                  · Non-goal one (product boundary)
                </Text>
                <Text className="text-sm leading-relaxed">· Non-goal two</Text>
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="design">
            <Stack gap={14}>
              <H2>Design</H2>
              <Stack gap={6}>
                <H2>Layers</H2>
                <Mermaid
                  aria-label="Layers"
                  direction="top-to-bottom"
                  edges={[
                    { source: "U", target: "A" },
                    { source: "A", target: "S" },
                    { label: "advanced", source: "U", target: "T" },
                    {
                      label: "not a done signal",
                      source: "T",
                      target: "X",
                    },
                  ]}
                  nodes={[
                    { id: "U", kind: "actor", title: "User / external orchestrator" },
                    { id: "A", kind: "agent", title: "Product semantics" },
                    { id: "S", kind: "artifact", title: "State source of truth" },
                    { id: "T", kind: "tool", title: "Low-level I/O" },
                    { id: "X", title: "Misuse", tone: "danger" },
                  ]}
                />
                <Text className="text-sm leading-relaxed">
                  · Day 1 stays on the semantic layer.
                </Text>
                <Text className="text-sm leading-relaxed">
                  · Low-level I/O may exist, but it is not the completion
                  protocol.
                </Text>
              </Stack>

              <Stack gap={6}>
                <H2>State exits</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Means</TableHead>
                        <TableHead>Is not</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          ready
                        </TableCell>
                        <TableCell className="text-sm">Can continue</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          Not business success
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          waiting
                        </TableCell>
                        <TableCell className="text-sm">Needs a person</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          Not done
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={6}>
                <H2>Hard constraints</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">ID</TableHead>
                        <TableHead>Decision</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">H1</TableCell>
                        <TableCell className="text-sm">
                          A boundary that must not be crossed
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono text-xs">H2</TableCell>
                        <TableCell className="text-sm">
                          Learning / efficiency goal
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="path">
            <Stack gap={14}>
              <H2>Day 1</H2>
              <Mermaid
                aria-label="Day-1 loop"
                direction="left-to-right"
                edges={[
                  { source: "A", target: "B" },
                  { source: "B", target: "C" },
                  { label: "continue", source: "C", target: "D" },
                  { source: "D", target: "C" },
                  { label: "needs a person", source: "C", target: "E" },
                  { source: "E", target: "C" },
                  { label: "failed", source: "C", target: "F" },
                ]}
                nodes={[
                  { id: "A", kind: "tool", title: "Discover" },
                  { id: "B", kind: "tool", title: "Start" },
                  { id: "C", title: "Actionable exit", tone: "warning" },
                  { id: "D", kind: "tool", title: "Next turn" },
                  { id: "E", kind: "artifact", title: "Attention list" },
                  { id: "F", title: "Stop + next", tone: "danger" },
                ]}
              />
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Command / action</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>User sees</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        command list
                      </TableCell>
                      <TableCell className="text-sm">Discover</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        The set of options
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        command start …
                      </TableCell>
                      <TableCell className="text-sm">Start work</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        Handle + default closed-loop result
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <Stack gap={4}>
                <H2>Recipe</H2>
                <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {`# Shortest human path
step1
step2

# Same path in a script (if applicable)
step1 --json
step2 --json`}
                </pre>
              </Stack>
              <Stack gap={4}>
                <H2>Do not teach on Day 1</H2>
                <Text className="text-sm leading-relaxed">
                  · Advanced-surface details (keep them off the first page)
                </Text>
              </Stack>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="landing">
            <Stack gap={14}>
              <H2>Landing</H2>
              <Text tone="secondary" className="text-sm leading-relaxed">
                After this page an implementer can change defaults and
                schedule. Acceptance tables belong here, not on Overview.
              </Text>

              <Stack gap={6}>
                <H2>Defaults before / after</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Surface</TableHead>
                        <TableHead>Today</TableHead>
                        <TableHead>Target</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-sm">Done signal</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          Easy-to-misuse legacy signal
                        </TableCell>
                        <TableCell className="text-sm">
                          Product-defined exit state
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="text-sm">Main path</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          User must assemble the steps
                        </TableCell>
                        <TableCell className="text-sm">
                          Default encapsulation
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={6}>
                <H2>Phases</H2>
                <Card>
                  <CardHeader className="pb-2">
                    <Row gap={8} wrap>
                      <Badge variant="info">Wave 1</Badge>
                      <CardTitle className="text-base">Contract</CardTitle>
                    </Row>
                    <CardDescription>
                      A result the user can feel (not only a ticket id)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Text className="text-sm leading-relaxed">
                      · L0 — slice title
                    </Text>
                  </CardContent>
                </Card>
              </Stack>

              <Stack gap={6}>
                <H2>Acceptance</H2>
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">ID</TableHead>
                        <TableHead>Condition</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-xs">C0</TableCell>
                        <TableCell className="text-sm">
                          User-story form: can they finish the main path without
                          learning the advanced surface?
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </Stack>

              <Stack gap={4}>
                <H2>Appendix (optional)</H2>
                <Text tone="secondary" className="text-sm leading-relaxed">
                  Competitor notes and process archaeology go at the end; they
                  must not become the default first page.
                </Text>
              </Stack>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
