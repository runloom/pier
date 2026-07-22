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
import type { ComposerAttachment } from "../terminal-composer-attachments-model.ts";
import {
  ATTACHMENT_LISTBOX_ID,
  type AttachmentAutocompleteItem,
  AttachmentAutocompletePopup,
} from "./attachment-autocomplete-popup.tsx";
import { $createAttachmentTokenNode } from "./attachment-token-node.tsx";
import { ComposerAutocompletePortal } from "./composer-autocomplete-portal.tsx";
import { $placeCaretAfterComposerChip } from "./composer-chip-caret.ts";

interface AttachmentMatch {
  leadOffset: number;
  matchingString: string;
}

/**
 * `#` trigger for inserting an existing attachment chip.
 * Exclude `[` so typing `[` does not open this menu.
 */
function getAttachmentMatch(
  text: string,
  cursor: number
): AttachmentMatch | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[\s({])#([^\s#]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const hashIndex = match.index + (match[1] ?? "").length;
  return {
    leadOffset: hashIndex,
    matchingString: match[2] ?? "",
  };
}

function filterAttachmentItems(
  attachments: readonly ComposerAttachment[],
  query: string
): AttachmentAutocompleteItem[] {
  const normalized = query.trim().toLowerCase();
  const items: AttachmentAutocompleteItem[] = attachments.map(
    (attachment, index) => ({
      attachment,
      ordinal: index + 1,
    })
  );
  if (normalized.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const ordinal = String(item.ordinal);
    if (ordinal === normalized || ordinal.startsWith(normalized)) {
      return true;
    }
    if (item.attachment.name.toLowerCase().includes(normalized)) {
      return true;
    }
    return item.attachment.path.toLowerCase().includes(normalized);
  });
}

export function AttachmentAutocompletePlugin({
  attachments,
  dismissMenuRef,
  menuOpenRef,
}: {
  attachments: readonly ComposerAttachment[];
  dismissMenuRef: { current: (() => void) | null };
  menuOpenRef: { current: boolean };
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const t = useT();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<AttachmentMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const matchRef = useRef(match);
  matchRef.current = match;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const queryRef = useRef(query);
  queryRef.current = query;

  const items = useMemo(
    () => filterAttachmentItems(attachments, query),
    [attachments, query]
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
          const found = getAttachmentMatch(
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
        const token = $createAttachmentTokenNode(
          item.attachment.path,
          item.ordinal,
          true
        );

        if (before.length === 0 && after.length === 0) {
          node.replace(token);
        } else if (before.length === 0) {
          node.setTextContent(after);
          node.insertBefore(token);
        } else {
          node.setTextContent(before);
          node.insertAfter(token);
          if (after.length > 0) {
            token.insertAfter($createTextNode(after));
          }
        }

        $placeCaretAfterComposerChip(token);
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
      if (root.getAttribute("aria-controls") === ATTACHMENT_LISTBOX_ID) {
        root.removeAttribute("aria-activedescendant");
        root.removeAttribute("aria-autocomplete");
        root.removeAttribute("aria-controls");
        root.removeAttribute("aria-expanded");
        if (root.getAttribute("role") === "combobox") {
          root.removeAttribute("role");
        }
      }
      return;
    }
    root.setAttribute("role", "combobox");
    root.setAttribute("aria-autocomplete", "list");
    root.setAttribute("aria-controls", ATTACHMENT_LISTBOX_ID);
    root.setAttribute("aria-expanded", "true");
    if (attachments.length === 0 || items.length === 0) {
      root.removeAttribute("aria-activedescendant");
      return;
    }
    root.setAttribute(
      "aria-activedescendant",
      `terminal-composer-attachment-option-${activeIndex}`
    );
  }, [activeIndex, attachments.length, editor, items.length, open]);

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
          event?.preventDefault();
          if (itemsRef.current.length === 0) {
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
          if (itemsRef.current.length === 0) {
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
      <AttachmentAutocompletePopup
        activeIndex={activeIndex}
        emptyAttachmentsBody={t(
          "terminal.composer.attachmentAutocompleteEmptyBody"
        )}
        emptyAttachmentsTitle={t(
          "terminal.composer.attachmentAutocompleteEmptyTitle"
        )}
        hasAttachments={attachments.length > 0}
        items={items}
        noResults={t("terminal.composer.attachmentAutocompleteNoResults")}
        onHover={setActiveIndex}
        onSelect={selectIndex}
      />
    </ComposerAutocompletePortal>
  );
}
