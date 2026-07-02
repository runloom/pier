import { Badge } from "@pier/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Input } from "@pier/ui/input.tsx";
import { InputGroup, InputGroupInput } from "@pier/ui/input-group.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useT } from "@/i18n/use-t.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";
import {
  closeWorktreeCreatePanel,
  setWorktreeCreateBase,
  setWorktreeCreateBranch,
  submitWorktreeCreate,
  updateWorktreeCreateInput,
  useWorktreeCreateStore,
} from "@/stores/worktree-create.store.ts";

const WORKTREE_CREATE_OVERLAY_ID = "worktree-create";
const HEAD_SENTINEL = "__head__";

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      {children}
    </>
  );
}

export function WorktreeCreateHost() {
  const t = useT();
  const session = useWorktreeCreateStore((state) => state.session);
  const hasSession = session !== null;

  useEffect(() => {
    if (!hasSession) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay(
      WORKTREE_CREATE_OVERLAY_ID
    );
    const releaseWebFocus = requestTerminalWebFocus(WORKTREE_CREATE_OVERLAY_ID);
    const scopeId = `overlay:${WORKTREE_CREATE_OVERLAY_ID}`;
    useKeybindingScope.getState().pushBlockingScope(scopeId);
    return () => {
      useKeybindingScope.getState().popBlockingScope(scopeId);
      releaseWebFocus();
      route.dispose();
    };
  }, [hasSession]);

  if (!session) {
    return null;
  }

  const creating = session.phase === "creating";
  const showAutoBadge = session.source !== "branch" && !session.branchEdited;
  const hasPrepare =
    session.copyPatternCount > 0 || session.setupCommand.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          closeWorktreeCreatePanel();
        }
      }}
      open
    >
      <DialogContent
        className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-3xl! p-0 sm:max-w-130"
        closeOnOverlayClick
        initialFocus="firstFocusable"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("worktree.create.title")}</DialogTitle>
          <DialogDescription>
            {t("worktree.create.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1.5 px-3 pt-2.5 text-muted-foreground text-xs">
          <GitBranch className="size-3.5" />
          {t("worktree.create.title")}
        </div>
        <div className="p-1">
          <InputGroup className="h-8! bg-input/50">
            <InputGroupInput
              aria-label={t("worktree.create.title")}
              autoFocus
              disabled={creating}
              onChange={(event) =>
                updateWorktreeCreateInput(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                submitWorktreeCreate({ start: !event.shiftKey }).catch(
                  () => undefined
                );
              }}
              placeholder={t("worktree.create.inputPlaceholder")}
              value={session.input}
            />
          </InputGroup>
        </div>
        <div className="grid grid-cols-[52px_1fr] items-center gap-x-3 gap-y-1.5 px-3 pt-1 pb-2.5 text-xs">
          <FieldRow label={t("worktree.create.branchLabel")}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Input
                aria-label={t("worktree.create.branchLabel")}
                className="h-6 flex-1 rounded-lg px-2 py-0 font-mono text-xs"
                disabled={creating}
                onChange={(event) =>
                  setWorktreeCreateBranch(event.target.value)
                }
                value={session.branch}
              />
              {showAutoBadge ? (
                <Badge className="h-4.5 px-1.5 text-[10px]" variant="secondary">
                  {t("worktree.create.autoBadge")}
                </Badge>
              ) : null}
            </span>
          </FieldRow>
          <FieldRow label={t("worktree.create.locationLabel")}>
            <span className="truncate px-2 font-mono text-muted-foreground">
              {`.worktrees/${session.name}`}
            </span>
          </FieldRow>
          <FieldRow label={t("worktree.create.baseLabel")}>
            <span className="flex min-w-0 items-center">
              <Select
                disabled={creating}
                onValueChange={(value) => {
                  setWorktreeCreateBase(value === HEAD_SENTINEL ? null : value);
                }}
                value={session.baseBranch ?? HEAD_SENTINEL}
              >
                <SelectTrigger className="h-6 w-fit gap-1 rounded-lg border-transparent bg-input/50 px-2 font-mono text-xs shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HEAD_SENTINEL}>
                    {t("worktree.create.baseHead")}
                  </SelectItem>
                  {session.branches.map((ref) => (
                    <SelectItem
                      key={`${ref.kind}:${ref.name}`}
                      value={ref.name}
                    >
                      {ref.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          </FieldRow>
          <FieldRow label={t("worktree.create.prepareLabel")}>
            <span className="flex min-w-0 flex-wrap items-center gap-1 px-2">
              {session.copyPatternCount > 0 ? (
                <Badge
                  className="h-4.5 px-1.5 font-normal text-[10px]"
                  variant="secondary"
                >
                  {t("worktree.create.prepareCopy", {
                    count: session.copyPatternCount,
                  })}
                </Badge>
              ) : null}
              {session.setupCommand.trim() ? (
                <Badge
                  className="h-4.5 px-1.5 font-normal text-[10px]"
                  variant="secondary"
                >
                  {t("worktree.create.prepareSetup")}
                </Badge>
              ) : null}
              {hasPrepare ? null : (
                <span className="text-muted-foreground">
                  {t("worktree.create.prepareNone")}
                </span>
              )}
            </span>
          </FieldRow>
        </div>
        {session.error ? (
          <p className="px-3 pb-2 text-destructive text-xs">{session.error}</p>
        ) : null}
        <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs">
          <span className="flex items-center gap-1">
            <Kbd>⏎</Kbd>
            {creating
              ? t("worktree.create.creating")
              : t("worktree.create.createAndStartHint")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧⏎</Kbd>
            {t("worktree.create.createOnlyHint")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            {t("worktree.create.cancelHint")}
          </span>
          <span className="ml-auto truncate">
            {t("worktree.create.emptyHint")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
