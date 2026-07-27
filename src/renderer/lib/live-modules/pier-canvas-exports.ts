import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@pier/ui/accordion.tsx";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@pier/ui/alert.tsx";
import { AspectRatio } from "@pier/ui/aspect-ratio.tsx";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@pier/ui/avatar.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@pier/ui/breadcrumb.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@pier/ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@pier/ui/field.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@pier/ui/hover-card.tsx";
import { Input } from "@pier/ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@pier/ui/input-group.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Kbd, KbdGroup } from "@pier/ui/kbd.tsx";
import { Label } from "@pier/ui/label.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@pier/ui/pagination.tsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@pier/ui/popover.tsx";
import { Progress } from "@pier/ui/progress.tsx";
import { RadioGroup, RadioGroupItem } from "@pier/ui/radio-group.tsx";
import { ScrollArea, ScrollBar } from "@pier/ui/scroll-area.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { Slider } from "@pier/ui/slider.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { StatusIcon } from "@pier/ui/status-icon.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@pier/ui/table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import { Toggle } from "@pier/ui/toggle.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import type { PierCanvasExportName } from "@shared/pier-canvas-export-names.ts";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { createElement } from "react";
import { useCanvasFile } from "./canvas-file-facade.ts";

/**
 * `pier/canvas` whitelist — host primitives + curated `@pier/ui` re-exports.
 * Typography/layout primitives use CSS variables so canvases look correct
 * without depending on Tailwind scanning `.pier/canvases`.
 *
 * Named keys must match `PIER_CANVAS_EXPORT_NAMES` (shared).
 */

type TextTone = "default" | "secondary" | "tertiary";

const TEXT_TONE_COLOR: Record<TextTone, string> = {
  default: "var(--foreground)",
  secondary: "var(--muted-foreground)",
  // No color-mix here — color-token governance; tertiary ≈ muted.
  tertiary: "var(--muted-foreground)",
};

const TEXT_AS_STYLE: Record<NonNullable<TextProps["as"]>, CSSProperties> = {
  h1: {
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: 1.2,
    margin: 0,
  },
  h2: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.015em",
    lineHeight: 1.3,
    margin: 0,
  },
  h3: {
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.35,
    margin: 0,
  },
  p: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.6,
    margin: 0,
  },
  span: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
  },
  div: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.6,
  },
};

export function Stack({
  children,
  className,
  gap = 16,
}: {
  children?: ReactNode;
  className?: string;
  gap?: string | number;
}) {
  return createElement(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: typeof gap === "number" ? `${gap}px` : gap,
        width: "100%",
        minWidth: 0,
      },
    },
    children
  );
}

export function Row({
  children,
  className,
  gap = 8,
  align = "center",
  justify = "flex-start",
  wrap = true,
}: {
  align?: CSSProperties["alignItems"];
  children?: ReactNode;
  className?: string;
  gap?: string | number;
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
}) {
  return createElement(
    "div",
    {
      className,
      style: {
        alignItems: align,
        display: "flex",
        flexWrap: wrap ? "wrap" : "nowrap",
        gap: typeof gap === "number" ? `${gap}px` : gap,
        justifyContent: justify,
        minWidth: 0,
        width: "100%",
      },
    },
    children
  );
}

/** Page-width frame for kit / docs / composition canvases. */
export function Frame({
  children,
  className,
  maxWidth = 880,
}: {
  children?: ReactNode;
  className?: string;
  maxWidth?: number;
}) {
  return createElement(
    "div",
    {
      className,
      style: {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        marginInline: "auto",
        maxWidth,
        minWidth: 0,
        paddingBlock: 8,
        width: "100%",
      },
    },
    children
  );
}

type TextProps = {
  as?: "p" | "span" | "div" | "h1" | "h2" | "h3";
  children?: ReactNode;
  className?: string;
  tone?: TextTone;
} & Omit<ComponentProps<"p">, "as" | "children" | "className" | "color">;

export function Text({
  children,
  className,
  as: Tag = "p",
  tone = "default",
  style,
  ...rest
}: TextProps) {
  return createElement(
    Tag,
    {
      ...rest,
      className,
      style: {
        ...TEXT_AS_STYLE[Tag],
        color: TEXT_TONE_COLOR[tone],
        ...style,
      },
    },
    children
  );
}

export const pierCanvasExports = {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  AspectRatio,
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  Badge,
  Breadcrumb,
  BreadcrumbEllipsis,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  Frame,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
  Kbd,
  KbdGroup,
  Label,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Row,
  ScrollArea,
  ScrollBar,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
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
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useCanvasFile,
} as const satisfies Record<PierCanvasExportName, unknown>;

export type PierCanvasExports = typeof pierCanvasExports;
