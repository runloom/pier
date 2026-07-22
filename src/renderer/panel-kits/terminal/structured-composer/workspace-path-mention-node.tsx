import { PierFileIcon } from "@pier/ui/file-icon.tsx";
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
import type { JSX } from "react";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_HOST_CLASS,
} from "./composer-chip-styles.ts";

export type SerializedWorkspacePathMentionNode = Spread<
  {
    absolutePath: string;
    label: string;
    type: "workspace-path-mention";
    version: 1;
  },
  SerializedLexicalNode
>;

export class WorkspacePathMentionNode extends DecoratorNode<JSX.Element> {
  __absolutePath: string;
  __label: string;

  static override getType(): string {
    return "workspace-path-mention";
  }

  static override clone(
    node: WorkspacePathMentionNode
  ): WorkspacePathMentionNode {
    return new WorkspacePathMentionNode(
      node.__absolutePath,
      node.__label,
      node.__key
    );
  }

  constructor(absolutePath: string, label: string, key?: NodeKey) {
    super(key);
    this.__absolutePath = absolutePath;
    this.__label = label;
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
    element.setAttribute("data-pier-mention-path", this.__absolutePath);
    element.textContent = this.__label;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return null;
  }

  static override importJSON(
    serialized: SerializedWorkspacePathMentionNode
  ): WorkspacePathMentionNode {
    return $createWorkspacePathMentionNode(
      serialized.absolutePath,
      serialized.label
    );
  }

  override exportJSON(): SerializedWorkspacePathMentionNode {
    return {
      absolutePath: this.__absolutePath,
      label: this.__label,
      type: "workspace-path-mention",
      version: 1,
    };
  }

  getAbsolutePath(): string {
    return this.__absolutePath;
  }

  getLabel(): string {
    return this.__label;
  }

  override getTextContent(): string {
    return this.__absolutePath;
  }

  override isInline(): boolean {
    return true;
  }

  /** Arrow keys step across via MentionAtomicSelectionPlugin (atomic unit). */
  override isKeyboardSelectable(): boolean {
    return false;
  }

  override decorate(): JSX.Element {
    return (
      <span
        className={cn(
          COMPOSER_CHIP_CLASS,
          "border-status-info-border bg-status-info-bg text-status-info-fg"
        )}
        contentEditable={false}
        data-mention-path={this.__absolutePath}
      >
        <PierFileIcon
          aria-hidden="true"
          className="shrink-0"
          fileName={this.__label}
          size={11}
        />
        <span className="truncate">@{this.__label}</span>
      </span>
    );
  }
}

export function $createWorkspacePathMentionNode(
  absolutePath: string,
  label: string
): WorkspacePathMentionNode {
  return $applyNodeReplacement(
    new WorkspacePathMentionNode(absolutePath, label)
  );
}

export function $isWorkspacePathMentionNode(
  node: LexicalNode | null | undefined
): node is WorkspacePathMentionNode {
  return node instanceof WorkspacePathMentionNode;
}
