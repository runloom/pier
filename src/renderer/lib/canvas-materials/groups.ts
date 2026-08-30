import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";
import type { CanvasMaterialFamilyId } from "./types.ts";

export interface CanvasMaterialGroup {
  family: CanvasMaterialFamilyId;
  id: string;
  members: readonly string[];
}

/**
 * Composite materials: one list row per product component.
 * Every visual `pier/canvas` export must appear here as an id or a member.
 * Host API domains are projected separately; sibling files stay `canvasFile`
 * (API family, shown first on the kit API capability catalog).
 */
export const CANVAS_MATERIAL_GROUPS: readonly CanvasMaterialGroup[] = [
  { family: "layout", id: "Frame", members: ["Frame"] },
  { family: "layout", id: "Stack", members: ["Stack"] },
  { family: "layout", id: "Row", members: ["Row"] },
  { family: "layout", id: "Text", members: ["Text"] },
  { family: "layout", id: "DocsShell", members: ["DocsShell"] },
  {
    family: "layout",
    id: "Artboard",
    members: ["Artboard", "ArtboardStage", "Layer", "WorldStage"],
  },
  { family: "layout", id: "Separator", members: ["Separator"] },
  { family: "layout", id: "ScrollArea", members: ["ScrollArea", "ScrollBar"] },
  { family: "layout", id: "AspectRatio", members: ["AspectRatio"] },
  {
    family: "control",
    id: "Accordion",
    members: [
      "Accordion",
      "AccordionContent",
      "AccordionItem",
      "AccordionTrigger",
    ],
  },
  {
    family: "control",
    id: "Alert",
    members: ["Alert", "AlertAction", "AlertDescription", "AlertTitle"],
  },
  {
    family: "control",
    id: "Avatar",
    members: [
      "Avatar",
      "AvatarBadge",
      "AvatarFallback",
      "AvatarGroup",
      "AvatarGroupCount",
      "AvatarImage",
    ],
  },
  { family: "control", id: "Badge", members: ["Badge"] },
  {
    family: "control",
    id: "Breadcrumb",
    members: [
      "Breadcrumb",
      "BreadcrumbEllipsis",
      "BreadcrumbItem",
      "BreadcrumbLink",
      "BreadcrumbList",
      "BreadcrumbPage",
      "BreadcrumbSeparator",
    ],
  },
  { family: "control", id: "Button", members: ["Button"] },
  {
    family: "control",
    id: "Card",
    members: [
      "Card",
      "CardContent",
      "CardDescription",
      "CardHeader",
      "CardTitle",
    ],
  },
  { family: "control", id: "Checkbox", members: ["Checkbox"] },
  {
    family: "control",
    id: "Collapsible",
    members: ["Collapsible", "CollapsibleContent", "CollapsibleTrigger"],
  },
  {
    family: "control",
    id: "DropdownMenu",
    members: [
      "DropdownMenu",
      "DropdownMenuCheckboxItem",
      "DropdownMenuContent",
      "DropdownMenuGroup",
      "DropdownMenuItem",
      "DropdownMenuLabel",
      "DropdownMenuPortal",
      "DropdownMenuRadioGroup",
      "DropdownMenuRadioItem",
      "DropdownMenuSeparator",
      "DropdownMenuShortcut",
      "DropdownMenuSub",
      "DropdownMenuSubContent",
      "DropdownMenuSubTrigger",
      "DropdownMenuTrigger",
    ],
  },
  {
    family: "control",
    id: "Empty",
    members: [
      "Empty",
      "EmptyContent",
      "EmptyDescription",
      "EmptyHeader",
      "EmptyMedia",
      "EmptyTitle",
    ],
  },
  {
    family: "control",
    id: "Field",
    members: [
      "Field",
      "FieldContent",
      "FieldDescription",
      "FieldError",
      "FieldGroup",
      "FieldLabel",
      "FieldLegend",
      "FieldSeparator",
      "FieldSet",
      "FieldTitle",
    ],
  },
  {
    family: "control",
    id: "HoverCard",
    members: ["HoverCard", "HoverCardContent", "HoverCardTrigger"],
  },
  { family: "control", id: "Input", members: ["Input"] },
  {
    family: "control",
    id: "InputGroup",
    members: [
      "InputGroup",
      "InputGroupAddon",
      "InputGroupButton",
      "InputGroupInput",
      "InputGroupText",
      "InputGroupTextarea",
    ],
  },
  {
    family: "control",
    id: "Item",
    members: [
      "Item",
      "ItemActions",
      "ItemContent",
      "ItemDescription",
      "ItemFooter",
      "ItemGroup",
      "ItemHeader",
      "ItemMedia",
      "ItemSeparator",
      "ItemTitle",
    ],
  },
  { family: "control", id: "Kbd", members: ["Kbd", "KbdGroup"] },
  { family: "control", id: "Label", members: ["Label"] },
  {
    family: "control",
    id: "Pagination",
    members: [
      "Pagination",
      "PaginationContent",
      "PaginationEllipsis",
      "PaginationItem",
      "PaginationLink",
      "PaginationNext",
      "PaginationPrevious",
    ],
  },
  {
    family: "control",
    id: "Popover",
    members: [
      "Popover",
      "PopoverAnchor",
      "PopoverContent",
      "PopoverDescription",
      "PopoverHeader",
      "PopoverTitle",
      "PopoverTrigger",
    ],
  },
  { family: "control", id: "Progress", members: ["Progress"] },
  {
    family: "control",
    id: "RadioGroup",
    members: ["RadioGroup", "RadioGroupItem"],
  },
  {
    family: "control",
    id: "Select",
    members: [
      "Select",
      "SelectContent",
      "SelectGroup",
      "SelectItem",
      "SelectLabel",
      "SelectScrollDownButton",
      "SelectScrollUpButton",
      "SelectSeparator",
      "SelectTrigger",
      "SelectValue",
    ],
  },
  { family: "control", id: "Skeleton", members: ["Skeleton"] },
  { family: "control", id: "Slider", members: ["Slider"] },
  {
    family: "control",
    id: "Sortable",
    members: ["Droppable", "Sortable"],
  },
  { family: "control", id: "Spinner", members: ["Spinner"] },
  { family: "control", id: "StatusIcon", members: ["StatusIcon"] },
  { family: "control", id: "Switch", members: ["Switch"] },
  {
    family: "control",
    id: "Tabs",
    members: ["Tabs", "TabsContent", "TabsList", "TabsTrigger"],
  },
  { family: "control", id: "Textarea", members: ["Textarea"] },
  { family: "control", id: "Toggle", members: ["Toggle"] },
  {
    family: "control",
    id: "ToggleGroup",
    members: ["ToggleGroup", "ToggleGroupItem"],
  },
  {
    family: "control",
    id: "Tooltip",
    members: ["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"],
  },
  {
    family: "viz",
    id: "Table",
    members: [
      "Table",
      "TableBody",
      "TableCaption",
      "TableCell",
      "TableFooter",
      "TableHead",
      "TableHeader",
      "TableRow",
    ],
  },
  { family: "viz", id: "DataChart", members: ["DataChart"] },
  { family: "viz", id: "Mermaid", members: ["Mermaid"] },
  { family: "data", id: "canvasFile", members: ["useCanvasFile"] },
  {
    family: "data",
    id: "activityOverview",
    members: ["useActivityOverview"],
  },
  { family: "data", id: "costOverview", members: ["useCostOverview"] },
  {
    family: "data",
    id: "systemResources",
    members: ["useSystemResources"],
  },
  {
    family: "data",
    id: "format",
    members: [
      "formatBytes",
      "formatCompactCurrency",
      "formatCompactNumber",
      "formatCount",
      "formatCurrency",
      "formatDurationShort",
      "formatPercent",
      "formatRelativeTime",
    ],
  },
];

export function ungroupedPierCanvasExports(): string[] {
  const owned = new Set(
    CANVAS_MATERIAL_GROUPS.flatMap((group) => [...group.members])
  );
  return [
    ...PIER_CANVAS_COMPONENT_EXPORT_NAMES,
    ...PIER_CANVAS_VALUE_EXPORT_NAMES,
  ].filter((name) => !owned.has(name));
}
