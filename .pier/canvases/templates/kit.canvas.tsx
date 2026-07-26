import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Frame,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Kbd,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Row,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Slider,
  Spinner,
  Stack,
  StatusIcon,
  Switch,
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
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "pier/canvas";
import type { ReactNode } from "react";

/**
 * Global component kit — scrollable catalog (design mock C).
 * Open: `.pier/canvases/templates/kit.canvas.tsx`
 */
export const canvas = {
  description:
    "Host pier/canvas whitelist — categorized catalog for composition and docs.",
  kind: "kit" as const,
  title: "Component kit",
};

function Section(props: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <Text tone="tertiary" style={{ fontSize: 12, fontWeight: 600 }}>
          {props.eyebrow}
        </Text>
        <Text as="h2">{props.title}</Text>
        <Text tone="secondary">{props.lead}</Text>
      </Stack>
      {props.children}
    </Stack>
  );
}

function Sample(props: { label: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle style={{ fontSize: 13 }}>{props.label}</CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

export default function KitCanvas() {
  return (
    <TooltipProvider>
      <Frame maxWidth={960}>
        <Stack gap={10}>
          <Row justify="space-between" align="start">
            <Stack gap={6}>
              <Text as="h1">pier/canvas</Text>
              <Text tone="secondary" style={{ maxWidth: 560 }}>
                Curated host kit from packages/ui plus layout primitives. Import
                these in composition and docs canvases; project UI still comes
                from relative paths or the preview barrel.
              </Text>
            </Stack>
            <Badge variant="info">kind · kit</Badge>
          </Row>
          <Row gap={8} wrap>
            <Badge variant="neutral">28px density</Badge>
            <Badge variant="neutral">rounded-full Button</Badge>
            <Badge variant="neutral">status tokens</Badge>
          </Row>
        </Stack>

        <Separator />

        <Section
          eyebrow="01 · Typography & layout"
          title="Text · Stack · Row · Frame"
          lead="Frame caps page width. Stack is vertical rhythm; Row is horizontal clusters; Text sets hierarchy and tone."
        >
          <Card>
            <CardContent>
              <Stack gap={12}>
                <Text as="h1">Heading 1</Text>
                <Text as="h2">Heading 2</Text>
                <Text as="h3">Heading 3</Text>
                <Text>Body — explain the proposal in plain language.</Text>
                <Text tone="secondary">Secondary — captions and hints.</Text>
                <Text tone="tertiary">Tertiary — metadata.</Text>
              </Stack>
            </CardContent>
          </Card>
        </Section>

        <Section
          eyebrow="02 · Actions"
          title="Button"
          lead="One accent action per region. Default height 28px; shape is rounded-full."
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Sample label="Variants">
              <Row gap={8} wrap>
                <Button>Default</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
              </Row>
            </Sample>
            <Sample label="Danger">
              <Button variant="destructive">Delete workspace</Button>
            </Sample>
          </div>
        </Section>

        <Section
          eyebrow="03 · Status"
          title="Badge · StatusIcon · Alert"
          lead="Short status labels and inline feedback. Prefer semantic variants."
        >
          <Stack gap={12}>
            <Sample label="Badge">
              <Row gap={8} wrap>
                <Badge>Default</Badge>
                <Badge variant="info">Info</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="danger">Danger</Badge>
                <Badge variant="done">Done</Badge>
                <Badge variant="neutral">Neutral</Badge>
                <Badge variant="outline">Outline</Badge>
              </Row>
            </Sample>
            <Sample label="StatusIcon">
              <Row gap={12}>
                <StatusIcon kind="success" />
                <StatusIcon kind="info" />
                <StatusIcon kind="warning" />
                <StatusIcon kind="error" />
              </Row>
            </Sample>
            <Alert variant="info">
              <Text style={{ fontWeight: 600 }}>Synced with the project kit</Text>
              <Text tone="secondary">
                Open templates/composition-checkout for a full design frame.
              </Text>
            </Alert>
          </Stack>
        </Section>

        <Section
          eyebrow="04 · Forms"
          title="Input · Select · Checkbox · Radio · Switch · Slider · Toggle"
          lead="Single-line controls use the shared 28px density."
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            }}
          >
            <Sample label="Input + Label">
              <Stack gap={6}>
                <Label htmlFor="kit-email">Email</Label>
                <Input id="kit-email" defaultValue="you@pier.dev" />
              </Stack>
            </Sample>
            <Sample label="Select">
              <Select defaultValue="comfortable">
                <SelectTrigger>
                  <SelectValue placeholder="Density" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </Sample>
            <Sample label="Checkbox">
              <Stack gap={8}>
                <Row gap={8}>
                  <Checkbox id="kit-email-ch" defaultChecked />
                  <Label htmlFor="kit-email-ch">Email</Label>
                </Row>
                <Row gap={8}>
                  <Checkbox id="kit-sms-ch" />
                  <Label htmlFor="kit-sms-ch">SMS</Label>
                </Row>
              </Stack>
            </Sample>
            <Sample label="RadioGroup">
              <RadioGroup defaultValue="comfortable">
                <Stack gap={8}>
                  <Row gap={8}>
                    <RadioGroupItem id="r-default" value="default" />
                    <Label htmlFor="r-default">Default</Label>
                  </Row>
                  <Row gap={8}>
                    <RadioGroupItem id="r-comfy" value="comfortable" />
                    <Label htmlFor="r-comfy">Comfortable</Label>
                  </Row>
                </Stack>
              </RadioGroup>
            </Sample>
            <Sample label="Switch">
              <Row justify="space-between">
                <Label htmlFor="kit-air">Airplane mode</Label>
                <Switch id="kit-air" defaultChecked />
              </Row>
            </Sample>
            <Sample label="ToggleGroup">
              <ToggleGroup type="single" defaultValue="comfortable">
                <ToggleGroupItem value="default">Default</ToggleGroupItem>
                <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
                <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
              </ToggleGroup>
            </Sample>
            <Sample label="Slider">
              <Slider defaultValue={[55]} max={100} step={1} />
            </Sample>
            <Sample label="Textarea">
              <Textarea defaultValue="Notes for this canvas…" rows={3} />
            </Sample>
          </div>
        </Section>

        <Section
          eyebrow="05 · Feedback & empty"
          title="Progress · Skeleton · Spinner · Empty · Tooltip · Kbd"
          lead="Loading and empty states for kit samples and Viewer chrome."
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Sample label="Progress">
              <Progress value={40} />
            </Sample>
            <Sample label="Skeleton">
              <Stack gap={8}>
                <Skeleton style={{ height: 12, width: "70%" }} />
                <Skeleton style={{ height: 12, width: "100%" }} />
                <Skeleton style={{ height: 12, width: "45%" }} />
              </Stack>
            </Sample>
            <Sample label="Spinner">
              <Spinner />
            </Sample>
            <Sample label="Kbd">
              <Row gap={6}>
                <Kbd>⌘</Kbd>
                <Kbd>⇧</Kbd>
                <Kbd>P</Kbd>
              </Row>
            </Sample>
            <Sample label="Tooltip">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Short hint</TooltipContent>
              </Tooltip>
            </Sample>
            <Sample label="Empty">
              <Empty className="min-h-24 border-0 p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <StatusIcon kind="info" />
                  </EmptyMedia>
                  <EmptyTitle>Nothing to show</EmptyTitle>
                  <EmptyDescription>Try another filter.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Sample>
          </div>
        </Section>

        <Section
          eyebrow="06 · Navigation & structure"
          title="Tabs · Accordion · Breadcrumb · Item"
          lead="In-page structure without app-shell navigation."
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            <Sample label="Tabs">
              <Tabs defaultValue="account">
                <TabsList>
                  <TabsTrigger value="account">Account</TabsTrigger>
                  <TabsTrigger value="password">Password</TabsTrigger>
                </TabsList>
                <TabsContent value="account">
                  <Text tone="secondary">Account settings panel.</Text>
                </TabsContent>
                <TabsContent value="password">
                  <Text tone="secondary">Password settings panel.</Text>
                </TabsContent>
              </Tabs>
            </Sample>
            <Sample label="Breadcrumb">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Skills</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Detail</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </Sample>
            <Sample label="Accordion">
              <Accordion type="single" collapsible defaultValue="item-1">
                <AccordionItem value="item-1">
                  <AccordionTrigger>When to use Button</AccordionTrigger>
                  <AccordionContent>
                    Prefer one accent action per region.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Sample>
            <Sample label="Item">
              <Item variant="outline">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>P</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Skill library</ItemTitle>
                  <ItemDescription>Item · title + description</ItemDescription>
                </ItemContent>
              </Item>
            </Sample>
          </div>
        </Section>

        <Section
          eyebrow="07 · Overlays"
          title="HoverCard · Avatar"
          lead="Static-friendly overlays. Prefer open samples over requiring hover in reviews."
        >
          <Sample label="HoverCard">
            <HoverCard open>
              <HoverCardTrigger asChild>
                <Button variant="ghost">@pier</Button>
              </HoverCardTrigger>
              <HoverCardContent>
                <Row gap={10} align="start">
                  <Avatar>
                    <AvatarFallback>P</AvatarFallback>
                  </Avatar>
                  <Stack gap={4}>
                    <Text style={{ fontWeight: 600 }}>@pier</Text>
                    <Text tone="secondary">
                      Local AI workbench. Host kit stays on one React singleton.
                    </Text>
                  </Stack>
                </Row>
              </HoverCardContent>
            </HoverCard>
          </Sample>
        </Section>

        <Section
          eyebrow="08 · Data"
          title="Table · Card"
          lead="Keep data samples small; prefer real project tables in composition canvases."
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            <Sample label="Table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Seats</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Studio</TableCell>
                    <TableCell>
                      <Badge variant="success">Active</Badge>
                    </TableCell>
                    <TableCell>5</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Team</TableCell>
                    <TableCell>
                      <Badge variant="info">Trial</Badge>
                    </TableCell>
                    <TableCell>12</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Sample>
            <Card>
              <CardHeader>
                <CardTitle>Plan summary</CardTitle>
                <CardDescription>Annual billing · seats included</CardDescription>
              </CardHeader>
              <CardContent>
                <Stack gap={10}>
                  <Text style={{ fontSize: 28, fontWeight: 600 }}>$24/mo</Text>
                  <Button>Choose plan</Button>
                </Stack>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Alert variant="info">
          <Text style={{ fontWeight: 600 }}>Next templates</Text>
          <Text tone="secondary">
            composition-checkout.canvas.tsx — design frame · docs-button.canvas.tsx
            — visual docs page.
          </Text>
        </Alert>
      </Frame>
    </TooltipProvider>
  );
}
