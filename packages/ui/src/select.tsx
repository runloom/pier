import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { useComposedRefs } from "radix-ui/internal";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { useFreezeFloatingOnClose } from "./freeze-floating-on-close.ts";
import {
  CONTROL_HEIGHT_CLASS,
  MENU_ITEM_DENSITY_CLASS,
} from "./interactive-density.ts";
import { floatingMenuScrollViewportClassName } from "./scroll-area.tsx";
import { useTerminalOverlay } from "./use-terminal-overlay.tsx";
import { cn } from "./utils.ts";

/**
 * True when Content has option rows but no SelectGroup yet.
 * Only compares against SelectGroup (defined above); bare SelectItem lists
 * get a default group so item padding / scroll-margin always apply.
 */
function selectContentNeedsDefaultGroup(children: ReactNode): boolean {
  let sawGroup = false;
  let sawBody = false;
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }
    if ((child as ReactElement).type === SelectGroup) {
      sawGroup = true;
      return;
    }
    sawBody = true;
  });
  return sawBody && !sawGroup;
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      className={cn("scroll-my-1.5 p-1", className)}
      data-slot="select-group"
      {...props}
    />
  );
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  asChild,
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  if (asChild) {
    return (
      <SelectPrimitive.Trigger
        asChild
        className={className}
        data-slot="select-trigger"
        {...props}
      >
        {children}
      </SelectPrimitive.Trigger>
    );
  }

  return (
    <SelectPrimitive.Trigger
      className={cn(
        CONTROL_HEIGHT_CLASS,
        "flex w-fit items-center justify-between gap-1.5 whitespace-nowrap rounded-2xl border border-transparent bg-input/50 px-3 text-sm outline-none transition-[color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-foreground/30 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const overlayRef = useTerminalOverlay();
  const freezeRef = useFreezeFloatingOnClose();
  const composedRef = useComposedRefs(props.ref, overlayRef, freezeRef);
  // Enforce SelectGroup for item padding / scroll margin. Call sites should
  // still write <SelectGroup> explicitly; this is a safety net for demos and
  // one-off lists that only pass bare SelectItem children.
  const content = selectContentNeedsDefaultGroup(children) ? (
    <SelectGroup>{children}</SelectGroup>
  ) : (
    children
  );
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        align={align}
        className={cn(
          // 外壳：实心 popover 底 + 上下滚动按钮。mask/fade 只在 Viewport。
          "app-no-drag data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 duration-100 data-[align-trigger=true]:animate-none data-closed:animate-out data-open:animate-in dark:ring-foreground/10",
          position === "popper" &&
            "data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className
        )}
        data-align-trigger={position === "item-aligned"}
        data-slot="select-content"
        position={position}
        {...props}
        ref={composedRef}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            floatingMenuScrollViewportClassName({ padding: false }),
            // Match trigger width as a floor, never its height: a 24px header
            // trigger like "FL" would otherwise become a one-line capsule.
            "data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
          )}
          data-position={position}
          data-scrollbar="overlay"
          data-slot="select-viewport"
        >
          {content}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-1 text-muted-foreground text-xs", className)}
      data-slot="select-label"
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  showIndicator = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  showIndicator?: boolean;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        MENU_ITEM_DENSITY_CLASS,
        "relative flex w-full select-none items-center gap-2 rounded-xl pl-2 outline-hidden focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        showIndicator ? "pr-8" : "pr-2",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      {showIndicator ? (
        <span
          className="pointer-events-none absolute right-2 flex size-4 items-center justify-center"
          data-slot="select-item-indicator"
        >
          <SelectPrimitive.ItemIndicator>
            <CheckIcon className="pointer-events-none" />
          </SelectPrimitive.ItemIndicator>
        </span>
      ) : null}
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="select-scroll-up-button"
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      data-slot="select-scroll-down-button"
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
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
};
