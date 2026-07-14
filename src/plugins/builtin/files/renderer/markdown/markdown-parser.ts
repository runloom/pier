import GithubSlugger from "github-slugger";
import type {
  Definition,
  ImageReference,
  LinkReference,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Node, Position } from "unist";
import {
  MARKDOWN_IR_VERSION,
  type MarkdownBlock,
  type MarkdownHeadingSummary,
  type MarkdownInline,
  type MarkdownIrDocument,
  type MarkdownParseRequest,
  type MarkdownParseResponse,
  type MarkdownSourceRange,
} from "./markdown-ir.ts";

export { MARKDOWN_IR_VERSION } from "./markdown-ir.ts";
export const MARKDOWN_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

interface DirectiveNode extends Parent {
  attributes?: Record<string, string>;
  name: string;
  type: "containerDirective" | "leafDirective" | "textDirective";
}

interface MathNode extends Node {
  meta?: string | null;
  type: "inlineMath" | "math";
  value: string;
}

interface FootnoteDefinitionNode extends Parent {
  identifier: string;
  label?: string;
  type: "footnoteDefinition";
}

interface FootnoteReferenceNode extends Node {
  identifier: string;
  label?: string;
  type: "footnoteReference";
}

function sourceRange(
  position: Position | null | undefined
): MarkdownSourceRange {
  return {
    endLine: position?.end.line ?? position?.start.line ?? 1,
    endOffset: position?.end.offset ?? position?.start.offset ?? 0,
    startLine: position?.start.line ?? 1,
    startOffset: position?.start.offset ?? 0,
  };
}

function directiveAttributes(
  attributes: Record<string, string> | null | undefined
): Record<string, string> {
  return attributes ? { ...attributes } : {};
}

function definitionFor(
  definitions: ReadonlyMap<string, Definition>,
  node: LinkReference | ImageReference
): Definition | undefined {
  return definitions.get(node.identifier.toLowerCase());
}

function inlineChildren(
  node: Parent,
  definitions: ReadonlyMap<string, Definition>
): MarkdownInline[] {
  return node.children.flatMap((child) =>
    phrasingToIr(child as PhrasingContent, definitions)
  );
}

function phrasingToIr(
  node: PhrasingContent,
  definitions: ReadonlyMap<string, Definition>
): MarkdownInline[] {
  const range = sourceRange(node.position);
  switch (node.type) {
    case "text":
      return [{ kind: "text", range, value: node.value }];
    case "inlineCode":
      return [{ kind: "inlineCode", range, value: node.value }];
    case "break":
      return [{ kind: "break", range }];
    case "emphasis":
      return [
        {
          children: inlineChildren(node, definitions),
          kind: "emphasis",
          range,
        },
      ];
    case "strong":
      return [
        { children: inlineChildren(node, definitions), kind: "strong", range },
      ];
    case "delete":
      return [
        { children: inlineChildren(node, definitions), kind: "delete", range },
      ];
    case "link":
      return [
        {
          children: inlineChildren(node, definitions),
          kind: "link",
          range,
          title: node.title ?? null,
          url: node.url,
        },
      ];
    case "image":
      return [
        {
          alt: node.alt ?? "",
          kind: "image",
          range,
          title: node.title ?? null,
          url: node.url,
        },
      ];
    case "linkReference": {
      const definition = definitionFor(definitions, node);
      if (!definition) {
        return [{ kind: "text", range, value: mdastToString(node) }];
      }
      return [
        {
          children: inlineChildren(node, definitions),
          kind: "link",
          range,
          title: definition.title ?? null,
          url: definition.url,
        },
      ];
    }
    case "imageReference": {
      const definition = definitionFor(definitions, node);
      if (!definition) {
        return [{ kind: "text", range, value: node.alt ?? "" }];
      }
      return [
        {
          alt: node.alt ?? "",
          kind: "image",
          range,
          title: definition.title ?? null,
          url: definition.url,
        },
      ];
    }
    case "footnoteReference": {
      const footnote = node as FootnoteReferenceNode;
      return [
        {
          identifier: footnote.identifier,
          kind: "footnoteReference",
          label: footnote.label ?? footnote.identifier,
          range,
        },
      ];
    }
    case "html":
      return [{ kind: "html", range, value: node.value }];
    case "inlineMath":
      return [{ kind: "inlineMath", range, value: (node as MathNode).value }];
    case "textDirective": {
      const directive = node as DirectiveNode;
      return [
        {
          attributes: directiveAttributes(directive.attributes),
          children: inlineChildren(directive, definitions),
          kind: "textDirective",
          name: directive.name,
          range,
        },
      ];
    }
    default:
      return [{ kind: "text", range, value: mdastToString(node) }];
  }
}

function nodeHasChildren(node: Node): node is Parent {
  return "children" in node && Array.isArray(node.children);
}

function collectDefinitions(
  node: Node,
  definitions: Map<string, Definition>
): void {
  if (node.type === "definition") {
    const definition = node as Definition;
    const identifier = definition.identifier.toLowerCase();
    if (!definitions.has(identifier)) {
      definitions.set(identifier, definition);
    }
  }
  if (nodeHasChildren(node)) {
    for (const child of node.children) {
      collectDefinitions(child, definitions);
    }
  }
}

function containerDirectiveBlocks(
  node: DirectiveNode,
  definitions: ReadonlyMap<string, Definition>,
  slugger: GithubSlugger,
  headings: MarkdownHeadingSummary[]
): MarkdownBlock[] {
  return node.children.flatMap((child) =>
    blockToIr(child as RootContent, definitions, slugger, headings)
  );
}

function blockToIr(
  node: RootContent,
  definitions: ReadonlyMap<string, Definition>,
  slugger: GithubSlugger,
  headings: MarkdownHeadingSummary[]
): MarkdownBlock[] {
  const range = sourceRange(node.position);
  switch (node.type) {
    case "heading": {
      const text = mdastToString(node);
      const id = slugger.slug(text);
      headings.push({ depth: node.depth, id, range, text });
      return [
        {
          children: inlineChildren(node, definitions),
          depth: node.depth,
          id,
          kind: "heading",
          range,
        },
      ];
    }
    case "paragraph":
      return [
        {
          children: inlineChildren(node, definitions),
          kind: "paragraph",
          range,
        },
      ];
    case "code":
      return [
        {
          kind: "code",
          lang: node.lang ?? null,
          meta: node.meta ?? null,
          range,
          value: node.value,
        },
      ];
    case "blockquote":
      return [
        {
          blocks: node.children.flatMap((child) =>
            blockToIr(child, definitions, slugger, headings)
          ),
          kind: "blockquote",
          range,
        },
      ];
    case "list":
      return [
        {
          items: node.children.map((item) => ({
            blocks: item.children.flatMap((child) =>
              blockToIr(child, definitions, slugger, headings)
            ),
            checked: item.checked ?? null,
            range: sourceRange(item.position),
          })),
          kind: "list",
          ordered: node.ordered === true,
          range,
          spread: node.spread === true,
          start: node.ordered ? (node.start ?? 1) : null,
        },
      ];
    case "table":
      return [
        {
          align: node.align ? [...node.align] : [],
          kind: "table",
          range,
          rows: node.children.map((row) => ({
            cells: row.children.map((cell) => ({
              children: inlineChildren(cell, definitions),
              range: sourceRange(cell.position),
            })),
            range: sourceRange(row.position),
          })),
        },
      ];
    case "thematicBreak":
      return [{ kind: "thematicBreak", range }];
    case "html":
      return [{ kind: "html", range, value: node.value }];
    case "math":
      return [
        {
          kind: "math",
          meta: (node as MathNode).meta ?? null,
          range,
          value: (node as MathNode).value,
        },
      ];
    case "containerDirective": {
      const directive = node as DirectiveNode;
      return [
        {
          attributes: directiveAttributes(directive.attributes),
          blocks: containerDirectiveBlocks(
            directive,
            definitions,
            slugger,
            headings
          ),
          kind: "containerDirective",
          name: directive.name,
          range,
        },
      ];
    }
    case "leafDirective": {
      const directive = node as DirectiveNode;
      return [
        {
          attributes: directiveAttributes(directive.attributes),
          children: inlineChildren(directive, definitions),
          kind: "leafDirective",
          name: directive.name,
          range,
        },
      ];
    }
    case "footnoteDefinition": {
      const footnote = node as FootnoteDefinitionNode;
      return [
        {
          blocks: footnote.children.flatMap((child) =>
            blockToIr(child as RootContent, definitions, slugger, headings)
          ),
          identifier: footnote.identifier,
          kind: "footnoteDefinition",
          label: footnote.label ?? footnote.identifier,
          range,
        },
      ];
    }
    case "definition":
      return [];
    default:
      return [
        {
          kind: "unsupported",
          nodeType: node.type,
          range,
          value: mdastToString(node),
        },
      ];
  }
}

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

export function parseMarkdownToIr(source: string): MarkdownIrDocument {
  const tree = markdownParser.parse(source) as Root;
  const definitions = new Map<string, Definition>();
  collectDefinitions(tree, definitions);
  const headings: MarkdownHeadingSummary[] = [];
  const slugger = new GithubSlugger();
  const blocks = tree.children.flatMap((node) =>
    blockToIr(node, definitions, slugger, headings)
  );
  return {
    blocks,
    headings,
    plainText: mdastToString(tree),
    sourceLength: source.length,
    version: MARKDOWN_IR_VERSION,
  };
}

export function markdownSourceFitsByteLimit(
  source: string,
  limit = MARKDOWN_MAX_SOURCE_BYTES
): boolean {
  let bytes = 0;
  for (const character of source) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7_ff) {
      bytes += 2;
    } else if (codePoint <= 0xff_ff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
    if (bytes > limit) {
      return false;
    }
  }
  return true;
}

export function parseMarkdownRequest(
  request: MarkdownParseRequest
): MarkdownParseResponse {
  if (!markdownSourceFitsByteLimit(request.source)) {
    return {
      code: "too-large",
      requestId: request.requestId,
      revision: request.revision,
      sessionId: request.sessionId,
      type: "error",
    };
  }
  try {
    return {
      document: parseMarkdownToIr(request.source),
      requestId: request.requestId,
      revision: request.revision,
      sessionId: request.sessionId,
      type: "parsed",
    };
  } catch {
    return {
      code: "parse-failed",
      requestId: request.requestId,
      revision: request.revision,
      sessionId: request.sessionId,
      type: "error",
    };
  }
}
