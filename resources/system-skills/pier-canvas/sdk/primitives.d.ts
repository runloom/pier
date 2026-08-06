import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  CSSProperties,
  HTMLAttributeReferrerPolicy,
  HTMLAttributes,
  ImgHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SVGProps,
  TableHTMLAttributes,
  TdHTMLAttributes,
  TextareaHTMLAttributes,
  ThHTMLAttributes,
} from "react";

/**
 * Generated prop types for Pier Canvas SDK primitives.
 *
 * DO NOT EDIT — regenerate with `pnpm canvas-sdk:generate-types`.
 * These types are extracted from `packages/ui/src/*.tsx` and inlined
 * so the SDK is standalone (no `@pier/ui` dependency).
 */

/** Fallback for components whose props could not be resolved. */
export interface CanvasPrimitiveProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  [prop: string]: unknown;
}

export type CanvasPrimitive = ComponentType<CanvasPrimitiveProps>;

export const Accordion: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical";
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const AccordionContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    forceMount?: true;
  }
>;
export const AccordionItem: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const AccordionTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
  }
>;
export const Alert: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "info" | "success" | "warning" | "destructive" | null;
  }
>;
export const AlertAction: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const AlertDescription: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const AlertTitle: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const AspectRatio: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    ratio?: number;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const Avatar: ComponentType<
  HTMLAttributes<HTMLSpanElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const AvatarBadge: ComponentType<
  HTMLAttributes<HTMLSpanElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
  }
>;
export const AvatarFallback: ComponentType<
  HTMLAttributes<HTMLSpanElement> & {
    delayMs?: number;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const AvatarGroup: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
  }
>;
export const AvatarGroupCount: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
  }
>;
export const AvatarImage: ComponentType<
  ImgHTMLAttributes<HTMLImageElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    crossOrigin?: "" | "anonymous" | "use-credentials";
    decoding?: "auto" | "async" | "sync";
    fetchPriority?: "auto" | "high" | "low";
    height?: string | number;
    loading?: "eager" | "lazy";
    referrerPolicy?: HTMLAttributeReferrerPolicy;
    sizes?: string;
    srcSet?: string;
    useMap?: string;
    width?: string | number;
  }
>;
export const Badge: ComponentType<
  HTMLAttributes<HTMLSpanElement> & {
    size?: "default" | "xs" | null;
    variant?:
      | "default"
      | "secondary"
      | "destructive"
      | "danger"
      | "done"
      | "info"
      | "neutral"
      | "outline"
      | "ghost"
      | "link"
      | "success"
      | "warning"
      | null;
  } & { asChild?: boolean }
>;
export const Breadcrumb: ComponentType<
  HTMLAttributes<HTMLElement> & { pageTitle?: string }
>;
export const BreadcrumbEllipsis: ComponentType<HTMLAttributes<HTMLSpanElement>>;
export const BreadcrumbItem: ComponentType<HTMLAttributes<HTMLLIElement>>;
export const BreadcrumbLink: ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean }
>;
export const BreadcrumbList: ComponentType<HTMLAttributes<HTMLOListElement>>;
export const BreadcrumbPage: ComponentType<HTMLAttributes<HTMLSpanElement>>;
export const BreadcrumbSeparator: ComponentType<HTMLAttributes<HTMLLIElement>>;
export const Card: ComponentType<
  HTMLAttributes<HTMLDivElement> & { size?: "default" | "sm" }
>;
export const CardContent: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const CardDescription: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const CardHeader: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const CardTitle: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Collapsible: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    defaultOpen?: boolean;
    open?: boolean;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const CollapsibleContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    forceMount?: true;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const CollapsibleTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
  }
>;
export const DropdownMenu: ComponentType<
  { open?: boolean; defaultOpen?: boolean; modal?: boolean } & Record<
    string,
    unknown
  >
>;
export const DropdownMenuCheckboxItem: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    textValue?: string;
    inset?: boolean;
  }
>;
export const DropdownMenuContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    forceMount?: true;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "center" | "start" | "end";
    alignOffset?: number;
    arrowPadding?: number;
    avoidCollisions?: boolean;
    collisionBoundary?: (Element | null) | (Element | null)[];
    collisionPadding?:
      | number
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    updatePositionStrategy?: "always" | "optimized";
    loop?: boolean;
  }
>;
export const DropdownMenuGroup: ComponentType<
  {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  } & Record<string, unknown>
>;
export const DropdownMenuItem: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    textValue?: string;
    inset?: boolean;
    variant?: "default" | "destructive";
  }
>;
export const DropdownMenuLabel: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    inset?: boolean;
  }
>;
export const DropdownMenuPortal: ComponentType<
  { container?: Element | DocumentFragment | null; forceMount?: true } & Record<
    string,
    unknown
  >
>;
export const DropdownMenuRadioGroup: ComponentType<
  {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  } & Record<string, unknown>
>;
export const DropdownMenuRadioItem: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    textValue?: string;
    inset?: boolean;
  }
>;
export const DropdownMenuSeparator: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const DropdownMenuShortcut: ComponentType<
  HTMLAttributes<HTMLSpanElement>
>;
export const DropdownMenuSub: ComponentType<
  { open?: boolean; defaultOpen?: boolean } & Record<string, unknown>
>;
export const DropdownMenuSubContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    forceMount?: true;
    sideOffset?: number;
    align?: "start" | "end";
    alignOffset?: number;
    arrowPadding?: number;
    avoidCollisions?: boolean;
    collisionBoundary?: (Element | null) | (Element | null)[];
    collisionPadding?:
      | number
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    updatePositionStrategy?: "always" | "optimized";
    loop?: boolean;
  }
>;
export const DropdownMenuSubTrigger: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    textValue?: string;
    inset?: boolean;
  }
>;
export const DropdownMenuTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
  }
>;
export const Empty: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const EmptyContent: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const EmptyDescription: ComponentType<
  HTMLAttributes<HTMLParagraphElement>
>;
export const EmptyHeader: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const EmptyMedia: ComponentType<
  HTMLAttributes<HTMLDivElement> & { variant?: "default" | "icon" | null }
>;
export const EmptyTitle: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Field: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    orientation?: "vertical" | "horizontal" | "responsive" | null;
  }
>;
export const FieldContent: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const FieldDescription: ComponentType<
  HTMLAttributes<HTMLParagraphElement>
>;
export const FieldError: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    errors?: Array<
      | {
          message?: string;
        }
      | undefined
    >;
  }
>;
export const FieldGroup: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const FieldLabel: ComponentType<HTMLAttributes<HTMLElement>>;
export const FieldLegend: ComponentType<
  HTMLAttributes<HTMLLegendElement> & { variant?: "legend" | "label" }
>;
export const FieldSeparator: ComponentType<
  HTMLAttributes<HTMLDivElement> & { children?: ReactNode }
>;
export const FieldSet: ComponentType<HTMLAttributes<HTMLFieldSetElement>>;
export const FieldTitle: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const HoverCard: ComponentType<
  {
    open?: boolean;
    defaultOpen?: boolean;
    openDelay?: number;
    closeDelay?: number;
  } & Record<string, unknown>
>;
export const HoverCardContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    forceMount?: true;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "center" | "start" | "end";
    alignOffset?: number;
    arrowPadding?: number;
    avoidCollisions?: boolean;
    collisionBoundary?: (Element | null) | (Element | null)[];
    collisionPadding?:
      | number
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    updatePositionStrategy?: "always" | "optimized";
  }
>;
export const HoverCardTrigger: ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    referrerPolicy?: HTMLAttributeReferrerPolicy;
  }
>;
export const InputGroup: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const InputGroupAddon: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    align?: "inline-start" | "inline-end" | "block-start" | "block-end" | null;
  }
>;
export const InputGroupButton: ComponentType<
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      tone?: "default" | "muted" | null;
      variant?:
        | "default"
        | "outline"
        | "secondary"
        | "ghost"
        | "destructive"
        | "link"
        | null;
      size?:
        | "default"
        | "xs"
        | "status-bar"
        | "sm"
        | "lg"
        | "icon"
        | "icon-xs"
        | "icon-sm"
        | "icon-lg"
        | null;
    } & { asChild?: boolean },
    "size"
  > & { size?: "xs" | "sm" | "icon-xs" | "icon-sm" | null }
>;
export const InputGroupInput: ComponentType<
  InputHTMLAttributes<HTMLInputElement>
>;
export const InputGroupText: ComponentType<HTMLAttributes<HTMLSpanElement>>;
export const InputGroupTextarea: ComponentType<
  TextareaHTMLAttributes<HTMLTextAreaElement>
>;
export const Item: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "outline" | "muted" | null;
    size?: "default" | "sm" | "xs" | null;
  } & { asChild?: boolean }
>;
export const ItemActions: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const ItemContent: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const ItemDescription: ComponentType<
  HTMLAttributes<HTMLParagraphElement>
>;
export const ItemFooter: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const ItemGroup: ComponentType<HTMLAttributes<HTMLUListElement>>;
export const ItemHeader: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const ItemMedia: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    align?: "center" | "start" | null;
    variant?: "default" | "icon" | "image" | null;
  }
>;
export const ItemSeparator: ComponentType<HTMLAttributes<HTMLElement>>;
export const ItemTitle: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Kbd: ComponentType<HTMLAttributes<HTMLElement>>;
export const KbdGroup: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Pagination: ComponentType<HTMLAttributes<HTMLElement>>;
export const PaginationContent: ComponentType<HTMLAttributes<HTMLUListElement>>;
export const PaginationEllipsis: ComponentType<HTMLAttributes<HTMLSpanElement>>;
export const PaginationItem: ComponentType<HTMLAttributes<HTMLLIElement>>;
export const PaginationLink: ComponentType<
  { isActive?: boolean } & Pick<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      tone?: "default" | "muted" | null;
      variant?:
        | "default"
        | "outline"
        | "secondary"
        | "ghost"
        | "destructive"
        | "link"
        | null;
      size?:
        | "default"
        | "xs"
        | "status-bar"
        | "sm"
        | "lg"
        | "icon"
        | "icon-xs"
        | "icon-sm"
        | "icon-lg"
        | null;
    } & { asChild?: boolean },
    "size"
  > &
    AnchorHTMLAttributes<HTMLAnchorElement>
>;
export const PaginationNext: ComponentType<
  { isActive?: boolean } & Pick<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      tone?: "default" | "muted" | null;
      variant?:
        | "default"
        | "outline"
        | "secondary"
        | "ghost"
        | "destructive"
        | "link"
        | null;
      size?:
        | "default"
        | "xs"
        | "status-bar"
        | "sm"
        | "lg"
        | "icon"
        | "icon-xs"
        | "icon-sm"
        | "icon-lg"
        | null;
    } & { asChild?: boolean },
    "size"
  > &
    AnchorHTMLAttributes<HTMLAnchorElement> & { text?: string }
>;
export const PaginationPrevious: ComponentType<
  { isActive?: boolean } & Pick<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      tone?: "default" | "muted" | null;
      variant?:
        | "default"
        | "outline"
        | "secondary"
        | "ghost"
        | "destructive"
        | "link"
        | null;
      size?:
        | "default"
        | "xs"
        | "status-bar"
        | "sm"
        | "lg"
        | "icon"
        | "icon-xs"
        | "icon-sm"
        | "icon-lg"
        | null;
    } & { asChild?: boolean },
    "size"
  > &
    AnchorHTMLAttributes<HTMLAnchorElement> & { text?: string }
>;
export const Popover: ComponentType<
  { open?: boolean; defaultOpen?: boolean; modal?: boolean } & Record<
    string,
    unknown
  >
>;
export const PopoverAnchor: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const PopoverContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    forceMount?: true;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "center" | "start" | "end";
    alignOffset?: number;
    arrowPadding?: number;
    avoidCollisions?: boolean;
    collisionBoundary?: (Element | null) | (Element | null)[];
    collisionPadding?:
      | number
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    updatePositionStrategy?: "always" | "optimized";
    deferPointerDownOutside?: boolean;
  }
>;
export const PopoverDescription: ComponentType<
  HTMLAttributes<HTMLParagraphElement>
>;
export const PopoverHeader: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const PopoverTitle: ComponentType<HTMLAttributes<HTMLHeadingElement>>;
export const PopoverTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
  }
>;
export const Progress: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    max?: number;
    getValueLabel?: (value: number, max: number) => string;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    variant?: "default" | "destructive" | "success" | "warning" | null;
  }
>;
export const ScrollArea: ComponentType<
  {
    viewportClassName?: string;
    viewportFade?: "horizontal" | "vertical";
    viewportFadeProfile?: "short" | "bottom-only";
    scrollHideDelay?: number;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  } & Record<string, unknown>
>;
export const ScrollBar: ComponentType<
  {
    forceMount?: true;
    orientation?: "horizontal" | "vertical";
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  } & Record<string, unknown>
>;
export const Separator: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const Skeleton: ComponentType<HTMLAttributes<HTMLDivElement>>;
export const Spinner: ComponentType<SVGProps<SVGSVGElement>>;
export const StatusIcon: ComponentType<
  { kind: "success" | "info" | "warning" | "error"; className?: string } & Omit<
    HTMLAttributes<HTMLSpanElement>,
    "children"
  >
>;
export const Table: ComponentType<TableHTMLAttributes<HTMLTableElement>>;
export const TableBody: ComponentType<HTMLAttributes<HTMLTableSectionElement>>;
export const TableCaption: ComponentType<
  HTMLAttributes<HTMLTableCaptionElement>
>;
export const TableCell: ComponentType<TdHTMLAttributes<HTMLTableCellElement>>;
export const TableFooter: ComponentType<
  HTMLAttributes<HTMLTableSectionElement>
>;
export const TableHead: ComponentType<ThHTMLAttributes<HTMLTableCellElement>>;
export const TableHeader: ComponentType<
  HTMLAttributes<HTMLTableSectionElement>
>;
export const TableRow: ComponentType<HTMLAttributes<HTMLTableRowElement>>;
export const Tabs: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    orientation?: "horizontal" | "vertical";
    activationMode?: "manual" | "automatic";
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const TabsContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    forceMount?: true;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
  }
>;
export const TabsList: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    loop?: boolean;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    variant?: "line" | "default" | null;
  }
>;
export const TabsTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
  }
>;
export const Tooltip: ComponentType<
  {
    open?: boolean;
    defaultOpen?: boolean;
    delayDuration?: number;
    disableHoverableContent?: boolean;
  } & Record<string, unknown>
>;
export const TooltipContent: ComponentType<
  HTMLAttributes<HTMLDivElement> & {
    forceMount?: true;
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "center" | "start" | "end";
    alignOffset?: number;
    arrowPadding?: number;
    avoidCollisions?: boolean;
    collisionBoundary?: (Element | null) | (Element | null)[];
    collisionPadding?:
      | number
      | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    updatePositionStrategy?: "always" | "optimized";
  }
>;
export const TooltipProvider: ComponentType<
  {
    delayDuration?: number;
    skipDelayDuration?: number;
    disableHoverableContent?: boolean;
  } & Record<string, unknown>
>;
export const TooltipTrigger: ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    enterKeyHint?:
      | "search"
      | "enter"
      | "done"
      | "go"
      | "next"
      | "previous"
      | "send";
    radioGroup?: string;
    about?: string;
    datatype?: string;
    inlist?: unknown;
    prefix?: string;
    property?: string;
    resource?: string;
    rev?: string;
    typeof?: string;
    vocab?: string;
    autoCorrect?: string;
    autoSave?: string;
    color?: string;
    itemProp?: string;
    itemScope?: boolean;
    itemType?: string;
    itemID?: string;
    itemRef?: string;
    results?: number;
    security?: string;
    unselectable?: "off" | "on";
    popover?: "" | "auto" | "manual" | "hint";
    popoverTargetAction?: "toggle" | "show" | "hide";
    popoverTarget?: string;
    inert?: boolean;
    inputMode?:
      | "search"
      | "text"
      | "none"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal";
    is?: string;
    exportparts?: string;
    part?: string;
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML };
    asChild?: boolean;
    formAction?: string | ((formData: FormData) => void | Promise<void>);
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
    openOnFocus?: boolean;
  }
>;
