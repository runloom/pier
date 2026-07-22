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
import { Paperclip } from "lucide-react";
import type { JSX } from "react";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_HOST_CLASS,
} from "./composer-chip-styles.ts";

export type SerializedAttachmentTokenNode = Spread<
  {
    absolutePath: string;
    ordinal: number;
    type: "attachment-token";
    valid: boolean;
    version: 2;
  },
  SerializedLexicalNode
>;

export class AttachmentTokenNode extends DecoratorNode<JSX.Element> {
  __absolutePath: string;
  __ordinal: number;
  __valid: boolean;

  static override getType(): string {
    return "attachment-token";
  }

  static override clone(node: AttachmentTokenNode): AttachmentTokenNode {
    return new AttachmentTokenNode(
      node.__absolutePath,
      node.__ordinal,
      node.__valid,
      node.__key
    );
  }

  constructor(
    absolutePath: string,
    ordinal: number,
    valid = true,
    key?: NodeKey
  ) {
    super(key);
    this.__absolutePath = absolutePath;
    this.__ordinal = ordinal;
    this.__valid = valid;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = COMPOSER_CHIP_HOST_CLASS;
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-pier-attachment-path", this.__absolutePath);
    element.setAttribute(
      "data-pier-attachment-ordinal",
      String(this.__ordinal)
    );
    element.textContent = this.__absolutePath;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return null;
  }

  static override importJSON(
    serialized: SerializedAttachmentTokenNode
  ): AttachmentTokenNode {
    return $createAttachmentTokenNode(
      serialized.absolutePath,
      serialized.ordinal,
      serialized.valid
    );
  }

  override exportJSON(): SerializedAttachmentTokenNode {
    return {
      absolutePath: this.__absolutePath,
      ordinal: this.__ordinal,
      type: "attachment-token",
      valid: this.__valid,
      version: 2,
    };
  }

  getAbsolutePath(): string {
    return this.__absolutePath;
  }

  getOrdinal(): number {
    return this.__ordinal;
  }

  isValid(): boolean {
    return this.__valid;
  }

  setAbsolutePath(absolutePath: string): void {
    const writable = this.getWritable();
    writable.__absolutePath = absolutePath;
  }

  setOrdinal(ordinal: number): void {
    const writable = this.getWritable();
    writable.__ordinal = ordinal;
  }

  setValid(valid: boolean): void {
    const writable = this.getWritable();
    writable.__valid = valid;
  }

  override getTextContent(): string {
    return this.__absolutePath;
  }

  override isInline(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return false;
  }

  override decorate(): JSX.Element {
    const tone = this.__valid
      ? "border-status-done-border bg-status-done-bg text-status-done-fg"
      : "border-status-warning-border bg-status-warning-bg text-status-warning-fg";
    return (
      <span
        className={cn(COMPOSER_CHIP_CLASS, tone)}
        contentEditable={false}
        data-attachment-ordinal={this.__ordinal}
        data-attachment-path={this.__absolutePath}
        data-attachment-valid={this.__valid ? "true" : "false"}
      >
        <Paperclip aria-hidden="true" className="size-2.5 shrink-0" />
        <span className="tabular-nums">{this.__ordinal}</span>
      </span>
    );
  }
}

export function $createAttachmentTokenNode(
  absolutePath: string,
  ordinal: number,
  valid = true
): AttachmentTokenNode {
  return $applyNodeReplacement(
    new AttachmentTokenNode(absolutePath, ordinal, valid)
  );
}

export function $isAttachmentTokenNode(
  node: LexicalNode | null | undefined
): node is AttachmentTokenNode {
  return node instanceof AttachmentTokenNode;
}
