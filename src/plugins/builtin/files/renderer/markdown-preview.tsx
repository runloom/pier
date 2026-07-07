import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const BLOCKED_PROTOCOLS = new Set(["data:", "javascript:", "vbscript:"]);
const EXPLICIT_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const SAFE_ABSOLUTE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isProtocolRelativeUrl(value: string): boolean {
  return value.startsWith("//");
}

function hasExplicitProtocol(value: string): boolean {
  return EXPLICIT_PROTOCOL_PATTERN.test(value);
}

export function safeMarkdownUrl(value: string | null | undefined): string {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return "";
  }

  try {
    const parsed = new URL(trimmedValue, "https://pier.local");
    if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
      return "";
    }
    if (hasExplicitProtocol(trimmedValue)) {
      return SAFE_ABSOLUTE_PROTOCOLS.has(parsed.protocol) ? trimmedValue : "";
    }
    if (isProtocolRelativeUrl(trimmedValue)) {
      return "";
    }
    return trimmedValue;
  } catch {
    return "";
  }
}

function preventRendererNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

export function MarkdownPreview({ value }: { value: string }) {
  return (
    <div className="h-full overflow-auto bg-background p-4 text-foreground text-sm">
      <div className="flex max-w-none flex-col gap-3 leading-6">
        <ReactMarkdown
          components={{
            a: ({ children, href }) => {
              const safeHref = safeMarkdownUrl(href);
              return (
                <a
                  aria-disabled={safeHref ? undefined : true}
                  className="font-medium text-primary underline underline-offset-4 aria-disabled:pointer-events-none aria-disabled:text-muted-foreground aria-disabled:no-underline"
                  href={safeHref || undefined}
                  onClick={preventRendererNavigation}
                  rel="noreferrer noopener"
                  target={safeHref ? "_blank" : undefined}
                >
                  {children}
                </a>
              );
            },
            blockquote: ({ children }) => (
              <blockquote className="border-border border-l-2 pl-3 text-muted-foreground">
                {children}
              </blockquote>
            ),
            code: ({ children, className }) => (
              <code
                className={
                  className
                    ? "rounded-md bg-muted px-1 py-0.5 font-mono text-foreground text-xs"
                    : "rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs"
                }
              >
                {children}
              </code>
            ),
            h1: ({ children }) => (
              <h1 className="font-semibold text-foreground text-xl leading-7">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="font-semibold text-foreground text-lg leading-7">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="font-semibold text-base text-foreground leading-6">
                {children}
              </h3>
            ),
            li: ({ children }) => <li className="pl-1">{children}</li>,
            ol: ({ children }) => (
              <ol className="ml-5 list-decimal">{children}</ol>
            ),
            p: ({ children }) => <p>{children}</p>,
            pre: ({ children }) => (
              <pre className="overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-foreground text-xs leading-5">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-left text-sm">
                  {children}
                </table>
              </div>
            ),
            tbody: ({ children }) => <tbody>{children}</tbody>,
            td: ({ children }) => (
              <td className="border-border border-t px-3 py-2 align-top">
                {children}
              </td>
            ),
            th: ({ children }) => (
              <th className="bg-muted/50 px-3 py-2 font-medium text-muted-foreground">
                {children}
              </th>
            ),
            thead: ({ children }) => <thead>{children}</thead>,
            tr: ({ children }) => <tr>{children}</tr>,
            ul: ({ children }) => (
              <ul className="ml-5 list-disc">{children}</ul>
            ),
          }}
          rehypePlugins={[rehypeSanitize]}
          remarkPlugins={[remarkGfm]}
          urlTransform={safeMarkdownUrl}
        >
          {value}
        </ReactMarkdown>
      </div>
    </div>
  );
}
