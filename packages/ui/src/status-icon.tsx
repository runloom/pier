import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "./utils.ts";

export type StatusIconKind = "success" | "info" | "warning" | "error";

function StatusGlyphShell({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & ComponentProps<"span">): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

function CheckGlyph(): ReactElement {
  return (
    <svg aria-hidden="true" className="size-2" fill="none" viewBox="0 0 10 10">
      <path
        d="M1.5 5.2 3.8 7.5 8.5 2.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function BangGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="size-2"
      fill="currentColor"
      viewBox="0 0 10 10"
    >
      <rect height="5" rx="0.8" width="1.6" x="4.2" y="1.2" />
      <circle cx="5" cy="8.1" r="0.95" />
    </svg>
  );
}

function InfoGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="size-2"
      fill="currentColor"
      viewBox="0 0 10 10"
    >
      <circle cx="5" cy="2.4" r="0.95" />
      <rect height="4.6" rx="0.8" width="1.6" x="4.2" y="4" />
    </svg>
  );
}

function WarningTriangleGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="currentColor"
      viewBox="0 0 18 18"
    >
      <path d="M8.05 2.6c.4-.72 1.5-.72 1.9 0l6.2 11.05c.4.72-.1 1.6-.95 1.6H2.8c-.85 0-1.35-.88-.95-1.6L8.05 2.6Z" />
      <g fill="var(--status-solid-foreground)">
        <rect height="5" rx="0.8" width="1.6" x="8.2" y="6.2" />
        <circle cx="9" cy="13.1" r="0.95" />
      </g>
    </svg>
  );
}

const STATUS_ICON_SHELL: Record<Exclude<StatusIconKind, "warning">, string> = {
  success: "bg-[color:var(--success)] text-status-solid-foreground",
  info: "bg-[color:var(--info)] text-status-solid-foreground",
  error: "bg-[color:var(--destructive)] text-status-solid-foreground",
};

/**
 * Shared status mark used by toast capsules and soft alerts.
 * success / info / error = filled circle + light glyph.
 * warning = filled triangle + light bang (toast-identical).
 */
function StatusIcon({
  kind,
  className,
  ...props
}: {
  kind: StatusIconKind;
  className?: string;
} & Omit<ComponentProps<"span">, "children">): ReactElement {
  if (kind === "warning") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center text-[color:var(--warning)]",
          className
        )}
        data-kind={kind}
        data-slot="status-icon"
        {...props}
      >
        <WarningTriangleGlyph />
      </span>
    );
  }

  function renderGlyph(): ReactElement {
    if (kind === "success") return <CheckGlyph />;
    if (kind === "info") return <InfoGlyph />;
    return <BangGlyph />;
  }

  return (
    <StatusGlyphShell
      className={cn(STATUS_ICON_SHELL[kind], className)}
      data-kind={kind}
      data-slot="status-icon"
      {...props}
    >
      {renderGlyph()}
    </StatusGlyphShell>
  );
}

export { StatusIcon };
