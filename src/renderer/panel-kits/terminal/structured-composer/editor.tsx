import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { cn } from "@pier/ui/utils.ts";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { ComposerAttachment } from "../composer-attachments-model.ts";
import { AttachmentAutocompletePlugin } from "./attachment-autocomplete-plugin.tsx";
import { AttachmentTokenNode } from "./attachment-token-node.tsx";
import { AttachmentTokenValidityPlugin } from "./attachment-token-validity-plugin.tsx";
import { DisableFormattingPlugin } from "./disable-formatting-plugin.tsx";
import { EmptyPlaceholderPlugin } from "./empty-placeholder-plugin.tsx";
import { EnterKeyPlugin } from "./enter-key-plugin.tsx";
import { MentionAtomicSelectionPlugin } from "./mention-atomic-selection-plugin.tsx";
import { MentionDeletePlugin } from "./mention-delete-plugin.tsx";
import { MentionPlugin } from "./mention-plugin.tsx";
import {
  insertAttachmentTokenAtLexicalSelection,
  insertLexicalPlainTextAtSelection,
  insertOrReplaceReviewCommentsChipInLexical,
  listInvalidAttachmentRefsInLexical,
  type ReviewCommentsChipInsert,
  rewriteAttachmentTokensInLexical,
} from "./mutations.ts";
import { OnChangePlainTextPlugin } from "./on-change-plain-text-plugin.tsx";
import { PastePlainTextPlugin } from "./paste-plain-text-plugin.tsx";
import { ReviewCommentsChipNode } from "./review-comments-chip-node.tsx";
import {
  readLexicalPlainSelection,
  readLexicalPlainText,
  setLexicalPlainSelection,
  writeLexicalPlainText,
} from "./serialize.ts";
import { SkillMentionNode } from "./skill-mention-node.tsx";
import { SkillSuggestPlugin } from "./skill-suggest-plugin.tsx";
import { registerComposerEditorForTests } from "./test-registry.ts";
import { WorkspacePathMentionNode } from "./workspace-path-mention-node.tsx";

export interface StructuredComposerEditorHandle {
  blur: () => void;
  /** Close @ / # / skill autocomplete without closing Rich Input. */
  dismissMentionMenu: () => void;
  focus: () => boolean;
  getElement: () => HTMLElement | null;
  getSelection: () => { cursor: number; selectionEnd: number };
  getValue: () => string;
  /** Insert an attachment chip at the caret without wiping @ mention chips. */
  insertAttachmentToken: (absolutePath: string, ordinal1Based: number) => void;
  /** Insert/replace the review-comments bundle chip; preserves other chips. */
  insertReviewCommentsChip: (input: ReviewCommentsChipInsert) => void;
  /** Insert plain text at the caret/selection; preserves mention chips. */
  insertTextAtSelection: (text: string) => void;
  /** True while @ / # / skill autocomplete is open. */
  isMentionMenuOpen: () => boolean;
  listInvalidAttachmentRefs: (
    attachments: readonly ComposerAttachment[]
  ) => string[];
  /** Drop/renumber attachment chips after removing a rail item. */
  rewriteAttachmentTokensAfterRemove: (
    removedAbsolutePath: string,
    nextAttachments: readonly ComposerAttachment[]
  ) => string;
  setSelection: (offset: number) => void;
  setValue: (text: string) => void;
}

export interface StructuredComposerEditorProps {
  /**
   * Foreground agent kind for skill invoke prefix (`/` vs `$`) and
   * discoverability filter. Null when unknown.
   */
  agentKind?: string | null;
  attachments: readonly ComposerAttachment[];
  /**
   * Composer chrome element for autocomplete width (list = chrome width).
   * Prefer the card with data-testid="terminal-composer".
   */
  chromeAnchor?: HTMLElement | null;
  className?: string;
  /** Single-line chrome: center text inside the fixed h-9 shell. */
  compact?: boolean;
  disabled: boolean;
  onCompositionEnd?: () => void;
  onCompositionStart?: () => void;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onLargePlainPaste: (text: string) => void;
  onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  onSend: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  /** Absolute project root for @ path mentions; null shows empty-project state. */
  projectRootPath: string | null;
  ref?: Ref<StructuredComposerEditorHandle>;
  /** Controlled plain-text draft from parent. */
  value: string;
}

function EditorHandleBridge({
  dismissAttachmentMenuRef,
  dismissMentionMenuRef,
  dismissSkillMenuRef,
  handleRef,
  menuOpenRef,
  value,
}: {
  dismissAttachmentMenuRef: { current: (() => void) | null };
  dismissMentionMenuRef: { current: (() => void) | null };
  dismissSkillMenuRef: { current: (() => void) | null };
  handleRef: Ref<StructuredComposerEditorHandle> | undefined;
  menuOpenRef: { current: boolean };
  value: string;
}): null {
  const [editor] = useLexicalComposerContext();
  const lastExternalValue = useRef(value);

  useImperativeHandle(
    handleRef,
    () => ({
      blur: () => {
        editor.getRootElement()?.blur();
      },
      dismissMentionMenu: () => {
        dismissMentionMenuRef.current?.();
        dismissAttachmentMenuRef.current?.();
        dismissSkillMenuRef.current?.();
      },
      focus: () => {
        const el = editor.getRootElement();
        if (!el || el.isContentEditable === false) {
          return false;
        }
        el.focus();
        return document.activeElement === el;
      },
      getElement: () => editor.getRootElement(),
      getSelection: () => readLexicalPlainSelection(editor),
      getValue: () => readLexicalPlainText(editor),
      insertAttachmentToken: (absolutePath: string, ordinal1Based: number) => {
        insertAttachmentTokenAtLexicalSelection(
          editor,
          absolutePath,
          ordinal1Based
        );
        lastExternalValue.current = readLexicalPlainText(editor);
      },
      insertReviewCommentsChip: (input) => {
        insertOrReplaceReviewCommentsChipInLexical(editor, input);
        lastExternalValue.current = readLexicalPlainText(editor);
      },
      insertTextAtSelection: (text: string) => {
        insertLexicalPlainTextAtSelection(editor, text);
        lastExternalValue.current = readLexicalPlainText(editor);
      },
      isMentionMenuOpen: () => menuOpenRef.current,
      listInvalidAttachmentRefs: (attachments) =>
        listInvalidAttachmentRefsInLexical(editor, attachments),
      rewriteAttachmentTokensAfterRemove: (
        removedAbsolutePath,
        nextAttachments
      ) => {
        const next = rewriteAttachmentTokensInLexical(
          editor,
          removedAbsolutePath,
          nextAttachments
        );
        lastExternalValue.current = next;
        return next;
      },
      setSelection: (offset: number) => {
        setLexicalPlainSelection(editor, offset);
      },
      setValue: (text: string) => {
        lastExternalValue.current = text;
        writeLexicalPlainText(editor, text);
      },
    }),
    [
      dismissAttachmentMenuRef,
      dismissMentionMenuRef,
      dismissSkillMenuRef,
      editor,
      menuOpenRef,
    ]
  );

  useEffect(() => registerComposerEditorForTests(editor), [editor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once seed from initial value
  useEffect(() => {
    writeLexicalPlainText(editor, value);
    lastExternalValue.current = value;
  }, [editor]);

  useEffect(() => {
    if (value === lastExternalValue.current) {
      return;
    }
    const current = readLexicalPlainText(editor);
    if (current === value) {
      lastExternalValue.current = value;
      return;
    }
    lastExternalValue.current = value;
    writeLexicalPlainText(editor, value);
  }, [editor, value]);

  return null;
}

function SyncEditable({ disabled }: { disabled: boolean }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);
  return null;
}

export function StructuredComposerEditor({
  agentKind = null,
  attachments,
  chromeAnchor = null,
  className,
  compact = false,
  disabled,
  onCompositionEnd,
  onCompositionStart,
  onFocus,
  onKeyDown,
  onPaste,
  onLargePlainPaste,
  onSend,
  onValueChange,
  placeholder,
  projectRootPath,
  ref,
  value,
}: StructuredComposerEditorProps) {
  const mentionMenuOpenRef = useRef(false);
  const attachmentMenuOpenRef = useRef(false);
  const skillMenuOpenRef = useRef(false);
  const dismissMentionMenuRef = useRef<(() => void) | null>(null);
  const dismissAttachmentMenuRef = useRef<(() => void) | null>(null);
  const dismissSkillMenuRef = useRef<(() => void) | null>(null);
  const anyMenuOpenRef = useMemo(
    () => ({
      get current() {
        return (
          mentionMenuOpenRef.current ||
          attachmentMenuOpenRef.current ||
          skillMenuOpenRef.current
        );
      },
      set current(_value: boolean) {
        // Slot refs are owned by @ / # / skill plugins; combined ref is read-only.
      },
    }),
    []
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: LexicalComposer config is mount-once
  const initialConfig = useMemo(
    () => ({
      editable: !disabled,
      namespace: "PierTerminalComposer",
      nodes: [
        WorkspacePathMentionNode,
        AttachmentTokenNode,
        SkillMentionNode,
        ReviewCommentsChipNode,
      ],
      onError: (error: Error) => {
        console.error("[structured-composer]", error);
      },
    }),
    []
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/*
        Layout + padding live on the outer shell. Empty placeholder is painted
        on the first empty <p> via CSS ::before (Cursor/Codex), not a Lexical
        sibling overlay — overlays hide the native caret when empty.
        Compact: center the editor in the h-9 chrome *outside* the editable —
        `flex h-full` on contenteditable makes the caret next to chips as tall
        as the shell.
      */}
      <div className={cn("min-w-0", className, compact && "flex items-center")}>
        <div className="relative w-full min-w-0">
          <MentionPlugin
            chromeAnchor={chromeAnchor}
            dismissMenuRef={dismissMentionMenuRef}
            menuOpenRef={mentionMenuOpenRef}
            projectRootPath={projectRootPath}
          />
          <AttachmentAutocompletePlugin
            attachments={attachments}
            chromeAnchor={chromeAnchor}
            dismissMenuRef={dismissAttachmentMenuRef}
            menuOpenRef={attachmentMenuOpenRef}
          />
          <SkillSuggestPlugin
            agentKind={agentKind}
            chromeAnchor={chromeAnchor}
            dismissMenuRef={dismissSkillMenuRef}
            menuOpenRef={skillMenuOpenRef}
            projectRootPath={projectRootPath}
          />
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={placeholder}
                className={cn(
                  "composer-editor-input w-full min-w-0 resize-none outline-none",
                  "font-sans text-foreground text-sm leading-5 caret-foreground",
                  "whitespace-pre-wrap break-words [&_p]:m-0",
                  compact
                    ? "overflow-x-hidden overflow-y-hidden"
                    : "field-sizing-content max-h-48 overflow-y-auto",
                  disabled && "cursor-not-allowed opacity-60"
                )}
                data-composer-draft={value}
                data-testid="terminal-composer-input"
                onCompositionEnd={onCompositionEnd}
                onCompositionStart={onCompositionStart}
                onFocus={onFocus}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                // Skill ids / paths must not get red squiggles while typing.
                spellCheck={false}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
            placeholder={null}
          />
        </div>
      </div>
      <HistoryPlugin />
      <DisableFormattingPlugin />
      <EmptyPlaceholderPlugin placeholder={placeholder} />
      <MentionAtomicSelectionPlugin />
      <MentionDeletePlugin />
      <PastePlainTextPlugin onLargePlainPaste={onLargePlainPaste} />
      <EnterKeyPlugin menuOpenRef={anyMenuOpenRef} onSend={onSend} />
      <AttachmentTokenValidityPlugin attachments={attachments} />
      <OnChangePlainTextPlugin
        onChange={(text) => {
          onValueChange(text);
        }}
      />
      <EditorHandleBridge
        dismissAttachmentMenuRef={dismissAttachmentMenuRef}
        dismissMentionMenuRef={dismissMentionMenuRef}
        dismissSkillMenuRef={dismissSkillMenuRef}
        handleRef={ref}
        menuOpenRef={anyMenuOpenRef}
        value={value}
      />
      <SyncEditable disabled={disabled} />
    </LexicalComposer>
  );
}
