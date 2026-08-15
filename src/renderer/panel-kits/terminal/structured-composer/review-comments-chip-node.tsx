import { cn } from "@pier/ui/utils.ts";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { MessageSquareText } from "lucide-react";
import type { JSX } from "react";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_HOST_CLASS,
  COMPOSER_CHIP_TONE_REVIEW,
} from "./composer-chip-styles.ts";

export type SerializedReviewCommentsChipNode = Spread<
  {
    count: number;
    label: string;
    payloadText: string;
    type: "review-comments-chip";
    version: 1;
  },
  SerializedLexicalNode
>;

/**
 * Atomic review-comments bundle chip.
 * Visual: short label; agent payload: full formatted block via getTextContent().
 */
export class ReviewCommentsChipNode extends DecoratorNode<JSX.Element> {
  __count: number;
  __label: string;
  __payloadText: string;

  static override getType(): string {
    return "review-comments-chip";
  }

  static override clone(node: ReviewCommentsChipNode): ReviewCommentsChipNode {
    return new ReviewCommentsChipNode(
      node.__count,
      node.__label,
      node.__payloadText,
      node.__key
    );
  }

  constructor(
    count: number,
    label: string,
    payloadText: string,
    key?: NodeKey
  ) {
    super(key);
    this.__count = count;
    this.__label = label;
    this.__payloadText = payloadText;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = COMPOSER_CHIP_HOST_CLASS;
    span.spellcheck = false;
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute(
      "data-pier-review-comments-count",
      String(this.__count)
    );
    element.textContent = this.__payloadText;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return null;
  }

  static override importJSON(
    serialized: SerializedReviewCommentsChipNode
  ): ReviewCommentsChipNode {
    return $createReviewCommentsChipNode(
      serialized.count,
      serialized.label,
      serialized.payloadText
    );
  }

  override exportJSON(): SerializedReviewCommentsChipNode {
    return {
      count: this.__count,
      label: this.__label,
      payloadText: this.__payloadText,
      type: "review-comments-chip",
      version: 1,
    };
  }

  getCount(): number {
    return this.__count;
  }

  getLabel(): string {
    return this.__label;
  }

  getPayloadText(): string {
    return this.__payloadText;
  }

  /** Agent-facing multi-line review block. */
  override getTextContent(): string {
    return this.__payloadText;
  }

  override isInline(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return false;
  }

  override decorate(): JSX.Element {
    return (
      <span
        className={cn(COMPOSER_CHIP_CLASS, COMPOSER_CHIP_TONE_REVIEW)}
        contentEditable={false}
        data-review-comments-count={this.__count}
        spellCheck={false}
        title={this.__label}
      >
        <MessageSquareText
          aria-hidden="true"
          className="size-2.5 shrink-0 self-center"
        />
        <span className="truncate">{this.__label}</span>
      </span>
    );
  }
}

export function $createReviewCommentsChipNode(
  count: number,
  label: string,
  payloadText: string
): ReviewCommentsChipNode {
  return $applyNodeReplacement(
    new ReviewCommentsChipNode(count, label, payloadText)
  );
}

export function $isReviewCommentsChipNode(
  node: LexicalNode | null | undefined
): node is ReviewCommentsChipNode {
  return node instanceof ReviewCommentsChipNode;
}
