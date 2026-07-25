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
import { Zap } from "lucide-react";
import type { JSX } from "react";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_HOST_CLASS,
  COMPOSER_CHIP_TONE_SKILL,
} from "./composer-chip-styles.ts";

export type SerializedSkillMentionNode = Spread<
  {
    invokeText: string;
    skillId: string;
    type: "skill-mention";
    version: 1;
  },
  SerializedLexicalNode
>;

/**
 * Atomic skill chip: visual highlight (no spellcheck waves), serializes to
 * agent-native invoke text (`/id` or `$id`).
 */
export class SkillMentionNode extends DecoratorNode<JSX.Element> {
  __invokeText: string;
  __skillId: string;

  static override getType(): string {
    return "skill-mention";
  }

  static override clone(node: SkillMentionNode): SkillMentionNode {
    return new SkillMentionNode(node.__skillId, node.__invokeText, node.__key);
  }

  constructor(skillId: string, invokeText: string, key?: NodeKey) {
    super(key);
    this.__skillId = skillId;
    this.__invokeText = invokeText;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = COMPOSER_CHIP_HOST_CLASS;
    // Decorator content is not editable text — keep spellcheck off on host.
    span.spellcheck = false;
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-pier-skill-id", this.__skillId);
    element.setAttribute("data-pier-skill-invoke", this.__invokeText);
    element.textContent = this.__invokeText;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return null;
  }

  static override importJSON(
    serialized: SerializedSkillMentionNode
  ): SkillMentionNode {
    return $createSkillMentionNode(serialized.skillId, serialized.invokeText);
  }

  override exportJSON(): SerializedSkillMentionNode {
    return {
      invokeText: this.__invokeText,
      skillId: this.__skillId,
      type: "skill-mention",
      version: 1,
    };
  }

  getSkillId(): string {
    return this.__skillId;
  }

  getInvokeText(): string {
    return this.__invokeText;
  }

  /** Agent-facing payload (prefix included). */
  override getTextContent(): string {
    return this.__invokeText;
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
        className={cn(COMPOSER_CHIP_CLASS, COMPOSER_CHIP_TONE_SKILL)}
        contentEditable={false}
        data-skill-id={this.__skillId}
        // Browser must not red-underline skill ids inside the pill.
        spellCheck={false}
      >
        <Zap aria-hidden="true" className="size-2.5 shrink-0" />
        <span className="truncate">{this.__skillId}</span>
      </span>
    );
  }
}

export function $createSkillMentionNode(
  skillId: string,
  invokeText: string
): SkillMentionNode {
  return $applyNodeReplacement(new SkillMentionNode(skillId, invokeText));
}

export function $isSkillMentionNode(
  node: LexicalNode | null | undefined
): node is SkillMentionNode {
  return node instanceof SkillMentionNode;
}
