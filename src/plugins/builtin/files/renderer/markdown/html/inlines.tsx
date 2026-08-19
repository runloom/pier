import { Fragment, type ReactNode } from "react";
import type { MarkdownInline } from "../ir.ts";
import { convertSanitizedFragment } from "./dom.tsx";
import { createMarkdownHtmlElement } from "./elements.tsx";
import { parseMarkdownHtmlInlineToken } from "./inline-token.ts";
import {
  pickSanitizedMarkdownHtmlAttrs,
  sanitizeMarkdownHtml,
} from "./sanitizer.ts";
import {
  isMarkdownHtmlTag,
  MARKDOWN_HTML_DROP_CHILDREN_TAGS,
  MARKDOWN_HTML_VOID_TAGS,
} from "./schema.ts";
import type { MarkdownHtmlRenderEnv } from "./types.ts";

interface HtmlInlineFrame {
  attrs: Readonly<Record<string, string>>;
  children: ReactNode[];
  dropChildren: boolean;
  ignored: boolean;
  name: string;
}

export function renderMarkdownHtmlInlines(
  inlines: readonly MarkdownInline[],
  env: MarkdownHtmlRenderEnv,
  renderMarkdownInline: (inline: MarkdownInline) => ReactNode
): ReactNode[] {
  const root: ReactNode[] = [];
  const stack: HtmlInlineFrame[] = [];
  const current = (): ReactNode[] => stack.at(-1)?.children ?? root;

  const push = (node: ReactNode, key: string) => {
    current().push(<Fragment key={key}>{node}</Fragment>);
  };

  for (const [index, inline] of inlines.entries()) {
    const key = `${inline.kind}-${inline.range.startOffset}-${inline.range.endOffset}-${index}`;
    if (inline.kind !== "html") {
      push(renderMarkdownInline(inline), key);
      continue;
    }
    const token = parseMarkdownHtmlInlineToken(inline.value);
    if (token.type === "comment") continue;
    if (token.type === "raw") {
      const fragment = sanitizeMarkdownHtml(token.value);
      const nodes = convertSanitizedFragment(fragment, {
        ...env,
        headingIds: [],
        searchMatches:
          env.searchMatchesForHtml?.(inline.range) ?? env.searchMatches,
      });
      push(nodes, key);
      continue;
    }
    if (token.type === "close") {
      closeHtmlInlineFrame(stack, root, token.name, env, key);
      continue;
    }
    const allowed = isMarkdownHtmlTag(token.name);
    const voidTag =
      token.selfClosing || MARKDOWN_HTML_VOID_TAGS.has(token.name);
    if (!allowed) {
      if (!voidTag) {
        stack.push({
          attrs: {},
          children: [],
          dropChildren: MARKDOWN_HTML_DROP_CHILDREN_TAGS.has(token.name),
          ignored: true,
          name: token.name,
        });
      }
      continue;
    }
    const attrs = pickSanitizedMarkdownHtmlAttrs(token.name, token.attrs);
    if (voidTag) {
      push(createMarkdownHtmlElement(token.name, attrs, [], env), key);
      continue;
    }
    stack.push({
      attrs,
      children: [],
      dropChildren: false,
      ignored: false,
      name: token.name,
    });
  }

  while (stack.length > 0) {
    flushHtmlInlineFrame(stack, root, env, `unclosed-${stack.length}`);
  }
  return root;
}

function closeHtmlInlineFrame(
  stack: HtmlInlineFrame[],
  root: ReactNode[],
  name: string,
  env: MarkdownHtmlRenderEnv,
  key: string
): void {
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) return;
    const parent = stack.at(-1)?.children ?? root;
    if (frame.ignored) {
      if (!frame.dropChildren) {
        parent.push(...frame.children);
      }
    } else {
      parent.push(
        <Fragment key={key}>
          {createMarkdownHtmlElement(
            frame.name,
            frame.attrs,
            frame.children,
            env,
            frame.name === "pre"
          )}
        </Fragment>
      );
    }
    if (frame.name === name) return;
  }
}

function flushHtmlInlineFrame(
  stack: HtmlInlineFrame[],
  root: ReactNode[],
  env: MarkdownHtmlRenderEnv,
  key: string
): void {
  const frame = stack.pop();
  if (!frame) return;
  const parent = stack.at(-1)?.children ?? root;
  if (frame.ignored) {
    if (!frame.dropChildren) {
      parent.push(...frame.children);
    }
    return;
  }
  parent.push(
    <Fragment key={key}>
      {createMarkdownHtmlElement(
        frame.name,
        frame.attrs,
        frame.children,
        env,
        frame.name === "pre"
      )}
    </Fragment>
  );
}
