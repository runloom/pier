import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { FilePathQueryItem } from "@shared/contracts/file-query.ts";
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
  type ComposerPathQuerySnapshot,
  createComposerPathQueryClient,
  joinProjectPath,
  mentionLabelFromRelativePath,
} from "./composer-path-query.ts";
import { MENTION_LISTBOX_ID, MentionPopup } from "./mention-popup.tsx";
import { $createWorkspacePathMentionNode } from "./workspace-path-mention-node.tsx";

interface MentionMatch {
  leadOffset: number;
  matchingString: string;
}

function getMentionMatch(text: string, cursor: number): MentionMatch | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s([{])@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const atIndex = match.index + (match[1] ?? "").length;
  return {
    leadOffset: atIndex,
    matchingString: match[2] ?? "",
  };
}

export function MentionPlugin({
  dismissMenuRef,
  menuOpenRef,
  projectRootPath,
}: {
  dismissMenuRef: { current: (() => void) | null };
  menuOpenRef: { current: boolean };
  projectRootPath: string | null;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const t = useT();
  const client = useMemo(() => createComposerPathQueryClient(), []);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<MentionMatch | null>(null);
  const [items, setItems] = useState<readonly FilePathQueryItem[]>([]);
  const [status, setStatus] =
    useState<ComposerPathQuerySnapshot["status"]>("idle");
  const [activeIndex, setActiveIndex] = useState(0);

  const matchRef = useRef(match);
  matchRef.current = match;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const projectRootRef = useRef(projectRootPath);
  projectRootRef.current = projectRootPath;
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
          const found = getMentionMatch(
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
      return;
    }
    if (!projectRootPath) {
      setItems([]);
      setStatus("done");
      return;
    }
    return client.search({
      onUpdate: (snap) => {
        setItems(snap.items);
        setStatus(snap.status);
        setActiveIndex(0);
      },
      query,
      root: projectRootPath,
    });
  }, [client, open, projectRootPath, query]);

  const selectIndex = useCallback(
    (index: number) => {
      const currentMatch = matchRef.current;
      const root = projectRootRef.current;
      const item = itemsRef.current[index];
      if (!(currentMatch && root && item)) {
        return;
      }
      const absolutePath = joinProjectPath(root, item.path);
      if (absolutePath == null) {
        return;
      }
      const label = mentionLabelFromRelativePath(item.path);
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
        const mention = $createWorkspacePathMentionNode(absolutePath, label);

        if (before.length === 0 && after.length === 0) {
          node.replace(mention);
        } else if (before.length === 0) {
          node.setTextContent(after);
          node.insertBefore(mention);
        } else {
          node.setTextContent(before);
          node.insertAfter(mention);
          if (after.length > 0) {
            mention.insertAfter($createTextNode(after));
          }
        }

        // Caret in a following TextNode (short caret); gap from host ::after.
        $placeCaretAfterComposerChip(mention);
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
    root.setAttribute("aria-controls", MENTION_LISTBOX_ID);
    root.setAttribute("aria-expanded", "true");
    if (!projectRootPath || items.length === 0) {
      root.removeAttribute("aria-activedescendant");
      return;
    }
    root.setAttribute(
      "aria-activedescendant",
      `terminal-composer-mention-option-${activeIndex}`
    );
  }, [activeIndex, editor, items.length, open, projectRootPath]);

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
          // Menu owns Enter while open — never fall through to send.
          event?.preventDefault();
          if (itemsRef.current.length === 0 || !projectRootRef.current) {
            return true;
          }
          selectIndex(activeIndexRef.current);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          event?.preventDefault();
          if (itemsRef.current.length === 0 || !projectRootRef.current) {
            return true;
          }
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

  return (
    <ComposerAutocompletePortal anchor={editor.getRootElement()}>
      <MentionPopup
        activeIndex={activeIndex}
        emptyProject={!projectRootPath}
        emptyProjectBody={t("terminal.composer.mentionEmptyProjectBody")}
        emptyProjectTitle={t("terminal.composer.mentionEmptyProjectTitle")}
        items={items}
        noResults={t("terminal.composer.mentionNoResults")}
        onHover={setActiveIndex}
        onSelect={selectIndex}
        placeholder={t("terminal.composer.mentionPlaceholder")}
        status={status}
      />
    </ComposerAutocompletePortal>
  );
}
