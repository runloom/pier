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
  formatBytes,
  formatCompactCurrency,
  formatCompactNumber,
  formatCount,
  formatCurrency,
  formatDurationShort,
  formatPercent,
  formatRelativeTime,
} from "@pier/ui/format.tsx";
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
import { useCanvasFile } from "./canvas-file-facade.ts";
import { useActivityOverview } from "./canvas-hooks/use-activity-overview.ts";
import { useCostOverview } from "./canvas-hooks/use-cost-overview.ts";
import { useSystemResources } from "./canvas-hooks/use-system-resources.ts";
import { Artboard, ArtboardStage } from "./pier-canvas-artboard.tsx";
import { DocsShell, Frame, Row, Stack, Text } from "./pier-canvas-layout.ts";
import { pierCanvasVisualizationExports } from "./pier-canvas-visualization-exports.ts";

/** Host primitives and curated UI exports; keys match `PIER_CANVAS_EXPORT_NAMES`. */

export const pierCanvasExports = {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Artboard,
  ArtboardStage,
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
  ...pierCanvasVisualizationExports,
  DocsShell,
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
  formatBytes,
  formatCompactCurrency,
  formatCompactNumber,
  formatCount,
  formatCurrency,
  formatDurationShort,
  formatPercent,
  formatRelativeTime,
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
  useActivityOverview,
  useCanvasFile,
  useCostOverview,
  useSystemResources,
} as const satisfies Record<PierCanvasExportName, unknown>;

export type PierCanvasExports = typeof pierCanvasExports;
