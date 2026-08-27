import { DATA_CATALOG_ENTRIES } from "./catalog-data.ts";
import type {
  CanvasMaterialCatalogEntry,
  CanvasMaterialProp,
} from "./types.ts";

export const CLASS_NAME_PROP: CanvasMaterialProp = {
  defaultValue: "—",
  descriptionKey: "settings.materials.prop.className",
  name: "className",
  type: "string",
};

function p(
  name: string,
  type: string,
  defaultValue: string,
  key: string
): CanvasMaterialProp {
  return {
    defaultValue,
    descriptionKey: `settings.materials.prop.${key}`,
    name,
    type,
  };
}

function entry(
  usage: string,
  ...props: CanvasMaterialProp[]
): CanvasMaterialCatalogEntry {
  return { props, usage };
}

export const CATALOG_ENTRIES: Record<string, CanvasMaterialCatalogEntry> = {
  Accordion: entry(
    [
      `<Accordion type="single" collapsible>`,
      `  <AccordionItem value="a">`,
      "    <AccordionTrigger>One</AccordionTrigger>",
      "    <AccordionContent>Two</AccordionContent>",
      "  </AccordionItem>",
      "</Accordion>",
    ].join("\n"),
    p("type", "single | multiple", "single", "type"),
    p("collapsible", "boolean", "false", "collapsible")
  ),
  Alert: entry(
    `<Alert variant="warning"><AlertTitle>…</AlertTitle></Alert>`,
    p(
      "variant",
      "default | info | success | warning | destructive",
      "default",
      "variant"
    )
  ),
  Artboard: entry(
    [
      "<WorldStage>",
      "  <Layer x={40} y={24}>",
      `    <Artboard preset="phone" title="Home">…</Artboard>`,
      "  </Layer>",
      "</WorldStage>",
    ].join("\n"),
    p("preset", "desktop | laptop | phone | tablet", "—", "artboardPreset"),
    p("label", "string", "—", "label"),
    p("title", "string", "—", "title"),
    p("width", "number", "1280", "width"),
    p("height", "number", "800", "height")
  ),
  AspectRatio: entry(
    "<AspectRatio ratio={16 / 9}>…</AspectRatio>",
    p("ratio", "number", "1", "ratio")
  ),
  Avatar: entry(
    "<Avatar><AvatarFallback>P</AvatarFallback></Avatar>",
    p("size", "default | sm | lg", "default", "size")
  ),
  Badge: entry(
    `<Badge variant="secondary">…</Badge>`,
    p(
      "variant",
      "default | secondary | outline | warning",
      "default",
      "variant"
    )
  ),
  Breadcrumb: entry(
    "<Breadcrumb><BreadcrumbList>…</BreadcrumbList></Breadcrumb>",
    CLASS_NAME_PROP
  ),
  Button: entry(
    `<Button variant="outline">Cancel</Button>`,
    p(
      "variant",
      "default | outline | secondary | destructive | ghost",
      "default",
      "buttonVariant"
    ),
    p("disabled", "boolean", "false", "buttonDisabled"),
    p("type", "button | submit", "button", "buttonType")
  ),
  Card: entry(
    "<Card><CardHeader><CardTitle>…</CardTitle></CardHeader></Card>",
    CLASS_NAME_PROP
  ),
  Checkbox: entry(
    "<Checkbox checked={false} />",
    p("checked", "boolean | indeterminate", "—", "checked"),
    p("disabled", "boolean", "false", "disabled")
  ),
  Collapsible: entry(
    [
      "<Collapsible defaultOpen>",
      "  <CollapsibleTrigger>One</CollapsibleTrigger>",
      "  <CollapsibleContent>Two</CollapsibleContent>",
      "</Collapsible>",
    ].join("\n"),
    p("open", "boolean", "—", "open")
  ),
  DataChart: entry(
    `<DataChart type="bar" categoryKey="day" series={series} data={rows} aria-label="…" />`,
    p("type", "area | bar | donut | line", "—", "dataChartType"),
    p("categoryKey", "string", "—", "categoryKey"),
    p("height", "number", "—", "height")
  ),
  DocsShell: entry(
    "<DocsShell nav={items} navId={id} onNavChange={setId}>…</DocsShell>",
    p("navId", "string", "—", "navId"),
    p("maxWidth", "number", "—", "maxWidth")
  ),
  DropdownMenu: entry(
    "<DropdownMenu><DropdownMenuTrigger>…</DropdownMenuTrigger></DropdownMenu>",
    CLASS_NAME_PROP
  ),
  Empty: entry(
    [
      "<Empty>",
      "  <EmptyHeader>",
      `    <EmptyMedia variant="icon">…</EmptyMedia>`,
      "    <EmptyTitle>Nothing here yet</EmptyTitle>",
      "    <EmptyDescription>Explain the next step.</EmptyDescription>",
      "  </EmptyHeader>",
      "  <EmptyContent>",
      `    <Button variant="outline">Add</Button>`,
      "  </EmptyContent>",
      "</Empty>",
    ].join("\n"),
    CLASS_NAME_PROP
  ),
  Field: entry(
    "<Field><FieldLabel>…</FieldLabel><Input /></Field>",
    p("orientation", "vertical | horizontal", "vertical", "orientation")
  ),
  FlowGraph: entry(
    [
      "<FlowGraph",
      `  aria-label="…"`,
      `  presentation="plain"`,
      "  nodes={[{ id, label, status, meta, badge }]}",
      "  edges={[{ source, target, label }]}",
      "  renderOverlay={({ positions }) => …}",
      "/>",
    ].join("\n"),
    p("nodes", "FlowGraphNode[]", "—", "nodes"),
    p("edges", "FlowGraphEdge[]", "—", "edges"),
    p(
      "direction",
      "left-to-right | top-to-bottom",
      "left-to-right",
      "direction"
    ),
    p("positions", "Record<string, { x, y }>", "—", "flowGraphPositions"),
    p(
      "onNodePositionsChange",
      "(positions) => void",
      "—",
      "onNodePositionsChange"
    ),
    p("onSelectNode", "(id) => void", "—", "onSelectNode"),
    p("renderNodeContent", "(node) => ReactNode", "—", "renderNodeContent"),
    p("renderOverlay", "(layout) => ReactNode", "—", "flowGraphOverlay"),
    p("expandable", "boolean", "true", "expandable")
  ),
  Frame: entry(
    "<Frame maxWidth={720}>…</Frame>",
    p("maxWidth", "number", "—", "maxWidth")
  ),
  HoverCard: entry(
    "<HoverCard><HoverCardTrigger>…</HoverCardTrigger></HoverCard>",
    CLASS_NAME_PROP
  ),
  Input: entry(
    `<Input placeholder="…" />`,
    p("placeholder", "string", "—", "placeholder"),
    p("disabled", "boolean", "false", "disabled")
  ),
  InputGroup: entry(
    "<InputGroup><InputGroupInput /><InputGroupAddon>…</InputGroupAddon></InputGroup>",
    CLASS_NAME_PROP
  ),
  Item: entry(
    "<Item><ItemTitle>…</ItemTitle></Item>",
    p("variant", "default | outline", "default", "variant")
  ),
  Kbd: entry("<Kbd>⌘K</Kbd>", CLASS_NAME_PROP),
  Label: entry(`<Label htmlFor="name">…</Label>`, CLASS_NAME_PROP),
  Mermaid: entry(
    [
      "<Mermaid",
      `  aria-label="…"`,
      "  nodes={[{ id, title, kind }]}",
      "  edges={[{ source, target }]}",
      "/>",
    ].join("\n"),
    p("nodes", "MermaidNode[]", "—", "nodes"),
    p("edges", "MermaidEdge[]", "—", "edges"),
    p("source", "string", "—", "mermaidSource"),
    p(
      "direction",
      "left-to-right | top-to-bottom",
      "left-to-right",
      "direction"
    ),
    p("renderNodeContent", "(node) => ReactNode", "—", "renderNodeContent"),
    p("expandable", "boolean", "true", "expandable")
  ),
  Pagination: entry(
    "<Pagination><PaginationContent>…</PaginationContent></Pagination>",
    CLASS_NAME_PROP
  ),
  Popover: entry(
    "<Popover><PopoverTrigger>…</PopoverTrigger></Popover>",
    CLASS_NAME_PROP
  ),
  Progress: entry(
    "<Progress value={40} />",
    p("value", "number", "—", "value"),
    p("max", "number", "100", "max")
  ),
  RadioGroup: entry(
    `<RadioGroup defaultValue="a"><RadioGroupItem value="a" /></RadioGroup>`,
    p("value", "string", "—", "value"),
    p("orientation", "horizontal | vertical", "vertical", "orientation")
  ),
  Row: entry(
    `<Row gap={8} align="center">…</Row>`,
    p("gap", "string | number", "—", "gap"),
    p("align", "CSS align-items", "—", "align"),
    p("wrap", "boolean", "false", "wrap")
  ),
  ScrollArea: entry(
    `<ScrollArea className="h-48">…</ScrollArea>`,
    CLASS_NAME_PROP
  ),
  Select: entry(
    "<Select><SelectTrigger><SelectValue /></SelectTrigger></Select>",
    p("value", "string", "—", "value"),
    p("disabled", "boolean", "false", "disabled")
  ),
  Separator: entry(
    `<Separator orientation="horizontal" />`,
    p("orientation", "horizontal | vertical", "horizontal", "orientation")
  ),
  Skeleton: entry(`<Skeleton className="h-6 w-32" />`, CLASS_NAME_PROP),
  Slider: entry(
    "<Slider defaultValue={[30]} max={100} />",
    p("value", "number[]", "—", "value"),
    p("max", "number", "100", "max"),
    p("step", "number", "1", "step")
  ),
  Sortable: entry(
    [
      `<Droppable id="todo">`,
      "  <Sortable",
      "    items={ids}",
      "    onDropItem={(id, index) => …}",
      "    onReorder={onReorder}",
      "  >",
      "    {(id, item) => (",
      "      <Item>",
      "        {item.handle}",
      "        <ItemTitle>{id}</ItemTitle>",
      "      </Item>",
      "    )}",
      "  </Sortable>",
      "</Droppable>",
    ].join("\n"),
    p("items", "string[]", "—", "sortableItems"),
    p("onReorder", "(items: string[]) => void", "—", "onReorder"),
    p(
      "onDropItem",
      "(itemId: string, index: number) => void",
      "—",
      "onDropItem"
    ),
    p("onDrop", "(itemId: string) => void", "—", "onDrop")
  ),
  Spinner: entry("<Spinner />", CLASS_NAME_PROP),
  Stack: entry(
    "<Stack fill gap={12}>…</Stack>",
    p("gap", "string | number", "—", "gap"),
    p("fill", "boolean", "false", "stackFill")
  ),
  StatusIcon: entry(
    `<StatusIcon kind="success" />`,
    p("kind", "success | warning | error | info", "—", "kind")
  ),
  Switch: entry(
    "<Switch checked={false} />",
    p("checked", "boolean", "—", "checked"),
    p("disabled", "boolean", "false", "disabled")
  ),
  Table: entry(
    "<Table><TableHeader>…</TableHeader><TableBody>…</TableBody></Table>",
    CLASS_NAME_PROP
  ),
  Tabs: entry(
    `<Tabs defaultValue="one"><TabsList><TabsTrigger value="one">…</TabsTrigger></TabsList></Tabs>`,
    p("value", "string", "—", "value"),
    p("orientation", "horizontal | vertical", "horizontal", "orientation")
  ),
  Text: entry(
    `<Text as="h2" tone="secondary">…</Text>`,
    p("as", "p | span | div | h1 | h2 | h3", "p", "as"),
    p("tone", "default | secondary | tertiary", "default", "tone")
  ),
  Textarea: entry(
    "<Textarea rows={4} />",
    p("rows", "number", "—", "rows"),
    p("disabled", "boolean", "false", "disabled")
  ),
  Toggle: entry(
    "<Toggle pressed={false}>…</Toggle>",
    p("pressed", "boolean", "—", "pressed"),
    p("variant", "default | outline", "default", "variant")
  ),
  ToggleGroup: entry(
    `<ToggleGroup type="single"><ToggleGroupItem value="a">…</ToggleGroupItem></ToggleGroup>`,
    p("type", "single | multiple", "—", "type"),
    p("value", "string | string[]", "—", "value")
  ),
  Tooltip: entry(
    "<Tooltip><TooltipTrigger>…</TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>",
    CLASS_NAME_PROP
  ),
  ...DATA_CATALOG_ENTRIES,
};
