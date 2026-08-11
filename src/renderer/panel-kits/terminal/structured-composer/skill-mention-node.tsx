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
import { SquareSlash, Zap } from "lucide-react";
import type { JSX } from "react";
import {
  COMPOSER_CHIP_CLASS,
  COMPOSER_CHIP_HOST_CLASS,
  COMPOSER_CHIP_TONE_COMMAND,
  COMPOSER_CHIP_TONE_SKILL,
} from "./composer-chip-styles.ts";

/** Skill package vs documented built-in slash command (list + chip affordance). */
export type SkillMentionKind = "command" | "skill";

export type SerializedSkillMentionNode = Spread<
  {
    invokeText: string;
    /** Omitted / unknown → skill (layout history). */
    kind?: SkillMentionKind;
    skillId: string;
    type: "skill-mention";
    version: 1;
  },
  SerializedLexicalNode
>;

function normalizeMentionKind(value: unknown): SkillMentionKind {
  return value === "command" ? "command" : "skill";
}

/**
 * Atomic skill/command chip: visual highlight (no spellcheck waves), serializes
 * to agent-native invoke text (`/id` or `$id`).
 */
export class SkillMentionNode extends DecoratorNode<JSX.Element> {
  __invokeText: string;
  __kind: SkillMentionKind;
  __skillId: string;

  static override getType(): string {
    return "skill-mention";
  }

  static override clone(node: SkillMentionNode): SkillMentionNode {
    return new SkillMentionNode(
      node.__skillId,
      node.__invokeText,
      node.__kind,
      node.__key
    );
  }

  constructor(
    skillId: string,
    invokeText: string,
    kind: SkillMentionKind = "skill",
    key?: NodeKey
  ) {
    super(key);
    this.__skillId = skillId;
    this.__invokeText = invokeText;
    this.__kind = kind;
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
    element.setAttribute("data-pier-skill-kind", this.__kind);
    element.textContent = this.__invokeText;
    return { element };
  }

  static override importDOM(): DOMConversionMap | null {
    return null;
  }

  static override importJSON(
    serialized: SerializedSkillMentionNode
  ): SkillMentionNode {
    return $createSkillMentionNode(serialized.skillId, serialized.invokeText, {
      kind: normalizeMentionKind(serialized.kind),
    });
  }

  override exportJSON(): SerializedSkillMentionNode {
    return {
      invokeText: this.__invokeText,
      kind: this.__kind,
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

  getKind(): SkillMentionKind {
    return this.__kind;
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
    const isCommand = this.__kind === "command";
    const Icon = isCommand ? SquareSlash : Zap;
    const tone = isCommand
      ? COMPOSER_CHIP_TONE_COMMAND
      : COMPOSER_CHIP_TONE_SKILL;
    return (
      <span
        className={cn(COMPOSER_CHIP_CLASS, tone)}
        contentEditable={false}
        data-skill-id={this.__skillId}
        data-skill-kind={this.__kind}
        // Browser must not red-underline skill ids inside the pill.
        spellCheck={false}
      >
        <Icon aria-hidden="true" className="size-2.5 shrink-0" />
        <span className="truncate">{this.__skillId}</span>
      </span>
    );
  }
}

export function $createSkillMentionNode(
  skillId: string,
  invokeText: string,
  options?: { kind?: SkillMentionKind }
): SkillMentionNode {
  return $applyNodeReplacement(
    new SkillMentionNode(
      skillId,
      invokeText,
      normalizeMentionKind(options?.kind)
    )
  );
}

export function $isSkillMentionNode(
  node: LexicalNode | null | undefined
): node is SkillMentionNode {
  return node instanceof SkillMentionNode;
}
