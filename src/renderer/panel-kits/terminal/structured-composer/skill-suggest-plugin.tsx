import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { shouldDeferImeEnter } from "@/lib/keybindings/ime-composition-gate.ts";
import { ComposerAutocompletePortal } from "./composer-autocomplete-portal.tsx";
import { $placeCaretAfterComposerChip } from "./composer-chip-caret.ts";
import {
  resolveComposerBundledSkillDescription,
  resolveComposerCommandDescription,
} from "./composer-command-i18n.ts";
import {
  type ComposerSkillQuerySnapshot,
  createComposerSkillQueryClient,
} from "./composer-skill-query.ts";
import {
  type ComposerSkillSuggestItem,
  getSkillSuggestMatch,
  getSkillSuggestNodeReplaceRange,
  preserveSuggestActiveIndex,
  visibleComposerSkillSuggestItems,
} from "./composer-skill-suggest.ts";
import { $plainPrefixToCaret } from "./serialize.ts";
import { $createSkillMentionNode } from "./skill-mention-node.tsx";
import {
  SKILL_SUGGEST_LISTBOX_ID,
  SkillSuggestPopup,
} from "./skill-suggest-popup.tsx";

interface SkillMatch {
  endOffset: number;
  leadOffset: number;
  matchingString: string;
  skillNamespace: boolean;
  trigger: "/";
}

export function SkillSuggestPlugin({
  agentKind,
  chromeAnchor = null,
  dismissMenuRef,
  isImeHeld,
  menuOpenRef,
  projectRootPath,
}: {
  agentKind: string | null;
  /** Composer chrome for list width; falls back to editor root. */
  chromeAnchor?: HTMLElement | null;
  dismissMenuRef: { current: (() => void) | null };
  isImeHeld: () => boolean;
  menuOpenRef: { current: boolean };
  projectRootPath: string | null;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const t = useT();
  const client = useMemo(() => createComposerSkillQueryClient(), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<SkillMatch | null>(null);
  const [items, setItems] = useState<readonly ComposerSkillSuggestItem[]>([]);
  const [status, setStatus] =
    useState<ComposerSkillQuerySnapshot["status"]>("idle");
  const [activeIndex, setActiveIndex] = useState(0);
  /** True after first successful load when list is empty for this agent. */
  const [catalogEmpty, setCatalogEmpty] = useState(false);

  const matchRef = useRef(match);
  matchRef.current = match;
  const itemsRef = useRef(items);
  const visibleItems = useMemo(
    () =>
      visibleComposerSkillSuggestItems(items, match?.skillNamespace === true),
    [items, match?.skillNamespace]
  );
  itemsRef.current = visibleItems;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const queryRef = useRef(query);
  queryRef.current = query;

  menuOpenRef.current = open;

  // NOTE: deliberately NO KEY_ESCAPE_COMMAND handler here. Lexical's native
  // keydown listener runs before the host React onKeyDown, so dismissing in
  // a Lexical command races the host's `isMentionMenuOpen()` check and lets
  // the same Esc close Rich Input. Escape belongs to the host layers
  // (composer.tsx onKeyDown / use-composer-escape), which dismiss via the
  // shared dismissMenuRef and keep Rich Input mounted.
  const dismissMenu = useCallback(() => {
    setOpen(false);
    setMatch(null);
  }, []);

  useEffect(() => {
    dismissMenuRef.current = dismissMenu;
    return () => {
      if (dismissMenuRef.current === dismissMenu) {
        dismissMenuRef.current = null;
      }
    };
  }, [dismissMenu, dismissMenuRef]);

  useEffect(() => () => client.dispose(), [client]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, visibleItems.length - 1));
  }, [visibleItems.length]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!($isRangeSelection(selection) && selection.isCollapsed())) {
            setOpen(false);
            setMatch(null);
            return;
          }
          const node = selection.anchor.getNode();
          if (!$isTextNode(node)) {
            setOpen(false);
            setMatch(null);
            return;
          }
          // Message-start only on full agent plain text (chips count as content).
          const plainPrefix = $plainPrefixToCaret();
          const prefixMatch =
            plainPrefix == null
              ? null
              : getSkillSuggestMatch(plainPrefix, agentKind);
          if (!prefixMatch) {
            setOpen(false);
            setMatch(null);
            return;
          }
          const range = getSkillSuggestNodeReplaceRange(
            node.getTextContent(),
            selection.anchor.offset,
            agentKind
          );
          if (!range) {
            setOpen(false);
            setMatch(null);
            return;
          }
          const found: SkillMatch = {
            endOffset: range.endOffset,
            leadOffset: range.leadOffset,
            matchingString: range.matchingString,
            skillNamespace: prefixMatch.skillNamespace,
            trigger: "/",
          };
          setMatch(found);
          if (found.matchingString !== queryRef.current) {
            setActiveIndex(0);
          }
          setQuery(found.matchingString);
          setOpen(true);
        });
      }),
    [agentKind, editor]
  );

  useEffect(() => {
    if (!open) {
      setItems([]);
      setStatus("idle");
      setCatalogEmpty(false);
      return;
    }
    if (!agentKind) {
      setItems([]);
      setStatus("done");
      setCatalogEmpty(true);
      return;
    }
    // Commands + bundled skills do not require a skills-service project entry.
    // Empty path still loads the static surface catalog.
    return client.search({
      agentKind,
      mapItem: (item) => {
        if (item.source === "builtin-command") {
          return {
            ...item,
            description: resolveComposerCommandDescription(
              t,
              agentKind,
              item.id,
              item.description
            ),
          };
        }
        if (item.source === "bundled") {
          return {
            ...item,
            description: resolveComposerBundledSkillDescription(
              t,
              agentKind,
              item.id,
              item.description
            ),
          };
        }
        return item;
      },
      onUpdate: (snap) => {
        const next = visibleComposerSkillSuggestItems(
          snap.items,
          matchRef.current?.skillNamespace === true
        );
        setActiveIndex((prev) =>
          preserveSuggestActiveIndex(prev, itemsRef.current, next)
        );
        setItems(snap.items);
        setStatus(snap.status);
        if (snap.status === "done" && queryRef.current.trim().length === 0) {
          setCatalogEmpty(snap.items.length === 0);
        }
      },
      projectRootPath: projectRootPath ?? "",
      query,
    });
  }, [agentKind, client, open, projectRootPath, query, t]);

  const selectIndex = useCallback(
    (index: number) => {
      const currentMatch = matchRef.current;
      const item = itemsRef.current[index];
      if (!(currentMatch && item)) {
        return;
      }
      editor.update(() => {
        const selection = $getSelection();
        if (!($isRangeSelection(selection) && selection.isCollapsed())) {
          return;
        }
        const node = selection.anchor.getNode();
        if (!$isTextNode(node)) {
          return;
        }
        const text = node.getTextContent();
        const start = currentMatch.leadOffset;
        const end = currentMatch.endOffset;
        if (start < 0 || end > text.length) {
          return;
        }
        // Force-invoke should be message-start: drop leading whitespace before `/`.
        const leading = text.slice(0, start);
        const replaceFrom = /^\s*$/.test(leading) ? 0 : start;
        const before = text.slice(0, replaceFrom);
        const after = text.slice(end);
        const skill = $createSkillMentionNode(item.id, item.invokeText, {
          kind: item.source === "builtin-command" ? "command" : "skill",
        });

        if (before.length === 0 && after.length === 0) {
          node.replace(skill);
        } else if (before.length === 0) {
          node.setTextContent(after);
          node.insertBefore(skill);
        } else {
          node.setTextContent(before);
          node.insertAfter(skill);
          if (after.length > 0) {
            skill.insertAfter($createTextNode(after));
          }
        }
        // Atomic chip — caret after pill (no plain-text skill id / no waves).
        $placeCaretAfterComposerChip(skill);
      });
      setOpen(false);
      setMatch(null);
    },
    [editor]
  );

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) {
      return;
    }
    if (!open) {
      root.removeAttribute("aria-activedescendant");
      root.removeAttribute("aria-autocomplete");
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-expanded");
      if (root.getAttribute("role") === "combobox") {
        root.removeAttribute("role");
      }
      return;
    }
    root.setAttribute("role", "combobox");
    root.setAttribute("aria-autocomplete", "list");
    root.setAttribute("aria-controls", SKILL_SUGGEST_LISTBOX_ID);
    root.setAttribute("aria-expanded", "true");
    if (visibleItems.length === 0) {
      root.removeAttribute("aria-activedescendant");
      return;
    }
    root.setAttribute(
      "aria-activedescendant",
      `terminal-composer-skill-option-${activeIndex}`
    );
  }, [activeIndex, editor, open, visibleItems.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const unsubs = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          event?.preventDefault();
          const len = itemsRef.current.length;
          if (len === 0) {
            return true;
          }
          setActiveIndex((current) => (current + 1) % len);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          event?.preventDefault();
          const len = itemsRef.current.length;
          if (len === 0) {
            return true;
          }
          setActiveIndex((current) => (current - 1 + len) % len);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (shouldDeferImeEnter(event, isImeHeld)) {
            return true;
          }
          // Only own Enter when there is something to insert — leave
          // `/model`-style free text and empty catalogs for send/edit.
          if (itemsRef.current.length === 0) {
            return false;
          }
          event?.preventDefault();
          selectIndex(activeIndexRef.current);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (itemsRef.current.length === 0) {
            return false;
          }
          event?.preventDefault();
          selectIndex(activeIndexRef.current);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
    ];
    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }, [editor, isImeHeld, open, selectIndex]);

  if (!open) {
    return null;
  }

  // Skill/command catalog no longer hard-requires a project path (static
  // surface entries). Keep emptyProject false; soft guidance lives in none-available.
  const emptyProject = false;
  const noAgent = agentKind == null;
  const showNotSupported =
    !noAgent &&
    catalogEmpty &&
    status === "done" &&
    visibleItems.length === 0 &&
    query.trim().length === 0;

  return (
    <ComposerAutocompletePortal
      anchor={chromeAnchor ?? editor.getRootElement()}
    >
      <SkillSuggestPopup
        activeIndex={activeIndex}
        emptyProject={emptyProject}
        emptyProjectBody={t("terminal.composer.skillEmptyProjectBody")}
        emptyProjectTitle={t("terminal.composer.skillEmptyProjectTitle")}
        items={visibleItems}
        noAgent={noAgent}
        noAgentBody={t("terminal.composer.skillNoAgentBody")}
        noAgentTitle={t("terminal.composer.skillNoAgentTitle")}
        noResults={t("terminal.composer.skillNoResults")}
        notSupportedBody={t("terminal.composer.skillNoneAvailableBody")}
        notSupportedTitle={t("terminal.composer.skillNoneAvailableTitle")}
        onHover={setActiveIndex}
        onSelect={selectIndex}
        placeholder={t("terminal.composer.skillPlaceholder")}
        showNotSupported={showNotSupported}
        status={status}
      />
    </ComposerAutocompletePortal>
  );
}
