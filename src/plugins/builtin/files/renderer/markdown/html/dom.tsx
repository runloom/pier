import { cloneElement, Fragment, isValidElement, type ReactNode } from "react";
import { sourceBlockProps } from "../ir-render-helpers.ts";
import { MarkdownSearchText } from "../search-mark.tsx";
import { createMarkdownHtmlElement } from "./elements.tsx";
import type { MarkdownHtmlRenderEnv } from "./types.ts";

export function convertSanitizedFragment(
  fragment: DocumentFragment,
  env: MarkdownHtmlRenderEnv
): ReactNode {
  const visible = { offset: 0 };
  const keys = { n: 0 };
  return [...fragment.childNodes].map((node) => (
    <Fragment key={nextHtmlNodeKey(keys)}>
      {convertNode(node, env, visible, keys, false)}
    </Fragment>
  ));
}

export function convertHtmlRootNodes(
  fragment: DocumentFragment,
  env: MarkdownHtmlRenderEnv
): ReactNode {
  const visible = { offset: 0 };
  const keys = { n: 0 };
  return [...fragment.childNodes].map((node) => {
    const rendered = convertNode(node, env, visible, keys, false);
    return (
      <Fragment key={nextHtmlNodeKey(keys)}>
        {withSourceProps(rendered, env)}
      </Fragment>
    );
  });
}

function withSourceProps(
  node: ReactNode,
  env: MarkdownHtmlRenderEnv
): ReactNode {
  if (node == null || node === false) return node;
  if (isValidElement(node)) {
    return cloneElement(node, sourceBlockProps(env.range, env));
  }
  return node;
}

function convertNode(
  node: Node,
  env: MarkdownHtmlRenderEnv,
  visible: { offset: number },
  keys: { n: number },
  insidePre: boolean
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const baseOffset = visible.offset;
    visible.offset += text.length;
    return (
      <MarkdownSearchText
        activeMatchId={env.activeSearchMatchId}
        baseOffset={baseOffset}
        matches={env.searchMatches}
        value={text}
      />
    );
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const name = element.tagName.toLowerCase();
  const nextInsidePre = insidePre || name === "pre";
  const children = [...element.childNodes].map((child) => (
    <Fragment key={nextHtmlNodeKey(keys)}>
      {convertNode(child, env, visible, keys, nextInsidePre)}
    </Fragment>
  ));
  return createMarkdownHtmlElement(
    name,
    attrsFromElement(element),
    children,
    env,
    nextInsidePre
  );
}

function attrsFromElement(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attribute of element.attributes) {
    attrs[attribute.name.toLowerCase()] = attribute.value;
  }
  return attrs;
}

function nextHtmlNodeKey(keys: { n: number }): string {
  keys.n += 1;
  return `md-html-${keys.n}`;
}
