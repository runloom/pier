import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "pier/canvas";
import { KitGrid, KitSection, MaterialCard } from "./shared.tsx";

export function OverlayControls() {
  return (
    <KitSection hint="折叠、悬停和弹出层。" title="浮层">
      <KitGrid>
        <MaterialCard
          install='import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "pier/canvas"'
          lead="可折叠分段"
          name="Accordion"
        >
          <Accordion className="w-56" collapsible type="single">
            <AccordionItem value="a">
              <AccordionTrigger>一段</AccordionTrigger>
              <AccordionContent>展开后的说明。</AccordionContent>
            </AccordionItem>
          </Accordion>
        </MaterialCard>
        <MaterialCard
          install='import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "pier/canvas"'
          lead="单段折叠"
          name="Collapsible"
        >
          <Collapsible defaultOpen>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline">
                展开
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-sm">
              折叠内容
            </CollapsibleContent>
          </Collapsible>
        </MaterialCard>
        <MaterialCard
          install='import { HoverCard, HoverCardContent, HoverCardTrigger } from "pier/canvas"'
          lead="悬停卡片"
          name="HoverCard"
        >
          <HoverCard>
            <HoverCardTrigger asChild>
              <Button type="button" variant="outline">
                悬停
              </Button>
            </HoverCardTrigger>
            <HoverCardContent>补充说明</HoverCardContent>
          </HoverCard>
        </MaterialCard>
        <MaterialCard
          install='import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "pier/canvas"'
          lead="弹出层"
          name="Popover"
        >
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline">
                打开
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>标题</PopoverTitle>
                <PopoverDescription>说明</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
        </MaterialCard>
        <MaterialCard
          install='import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "pier/canvas"'
          lead="悬停说明"
          name="Tooltip"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline">
                  悬停
                </Button>
              </TooltipTrigger>
              <TooltipContent>说明</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </MaterialCard>
      </KitGrid>
    </KitSection>
  );
}
