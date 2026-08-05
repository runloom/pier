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
  KEY_ESCAPE_COMMAND,
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
import { ComposerAutocompletePortal } from "./composer-autocomplete-portal.tsx";
import { $placeCaretAfterComposerChip } from "./composer-chip-caret.ts";
import {
  type ComposerSkillQuerySnapshot,
  createComposerSkillQueryClient,
} from "./composer-skill-query.ts";
import {
  type ComposerSkillSuggestItem,
  getSkillSuggestMatch,
} from "./composer-skill-suggest.ts";
import { $createSkillMentionNode } from "./skill-mention-node.tsx";
import {
  SKILL_SUGGEST_LISTBOX_ID,
  SkillSuggestPopup,
} from "./skill-suggest-popup.tsx";

interface SkillMatch {
  leadOffset: number;
  matchingString: string;
  trigger: "/";
}

export function SkillSuggestPlugin({
  agentKind,
  chromeAnchor = null,
  dismissMenuRef,
  menuOpenRef,
  projectRootPath,
}: {
  agentKind: string | null;
  /** Composer chrome for list width; falls back to editor root. */
  chromeAnchor?: HTMLElement | null;
  dismissMenuRef: { current: (() => void) | null };
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
  itemsRef.current = items;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const queryRef = useRef(query);
  queryRef.current = query;

  menuOpenRef.current = open;

  const dismissMenu = useCallback(() => {
    menuOpenRef.current = false;
    setOpen(false);
    setMatch(null);
  }, [menuOpenRef]);

  useEffect(() => {
    dismissMenuRef.current = dismissMenu;
    return () => {
      if (dismissMenuRef.current === dismissMenu) {
        dismissMenuRef.current = null;
      }
    };
  }, [dismissMenu, dismissMenuRef]);

  useEffect(() => () => client.dispose(), [client]);

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
          const found = getSkillSuggestMatch(
            node.getTextContent(),
            selection.anchor.offset
          );
          if (!found) {
            setOpen(false);
            setMatch(null);
            return;
          }
          setMatch(found);
          if (found.matchingString !== queryRef.current) {
            setActiveIndex(0);
          }
          setQuery(found.matchingString);
          setOpen(true);
        });
      }),
    [editor]
  );

  useEffect(() => {
    if (!open) {
      setItems([]);
      setStatus("idle");
      setCatalogEmpty(false);
      return;
    }
    if (!projectRootPath) {
      setItems([]);
      setStatus("done");
      setCatalogEmpty(false);
      return;
    }
    if (!agentKind) {
      setItems([]);
      setStatus("done");
      setCatalogEmpty(true);
      return;
    }
    return client.search({
      agentKind,
      onUpdate: (snap) => {
        setItems(snap.items);
        setStatus(snap.status);
        setActiveIndex(0);
        if (snap.status === "done" && queryRef.current.trim().length === 0) {
          setCatalogEmpty(snap.items.length === 0);
        }
      },
      projectRootPath,
      query,
    });
  }, [agentKind, client, open, projectRootPath, query]);

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
        const end = start + 1 + currentMatch.matchingString.length;
        if (start < 0 || end > text.length) {
          return;
        }
        const before = text.slice(0, start);
        const after = text.slice(end);
        const skill = $createSkillMentionNode(item.id, item.invokeText);

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
    if (items.length === 0) {
      root.removeAttribute("aria-activedescendant");
      return;
    }
    root.setAttribute(
      "aria-activedescendant",
      `terminal-composer-skill-option-${activeIndex}`
    );
  }, [activeIndex, editor, items.length, open]);

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
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          event?.preventDefault();
          dismissMenu();
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
  }, [dismissMenu, editor, open, selectIndex]);

  if (!open) {
    return null;
  }

  const emptyProject = !projectRootPath;
  const noAgent = !emptyProject && agentKind == null;
  const showNotSupported =
    !(emptyProject || noAgent) &&
    catalogEmpty &&
    status === "done" &&
    items.length === 0 &&
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
        items={items}
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
