import { Badge } from "@pier/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { GitBranch } from "lucide-react";
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

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          closeWorktreeCreatePanel();
        }
      }}
      open
    >
      <DialogContent className="max-w-lg gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="size-4" />
            {t("worktree.create.title")}
          </DialogTitle>
        </DialogHeader>
        <Input
          aria-label={t("worktree.create.title")}
          autoFocus
          disabled={creating}
          onChange={(event) => updateWorktreeCreateInput(event.target.value)}
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
        <div className="grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.branchLabel")}
          </span>
          <span className="flex items-center gap-2">
            <Input
              aria-label={t("worktree.create.branchLabel")}
              className="h-6 flex-1 font-mono text-xs"
              disabled={creating}
              onChange={(event) => setWorktreeCreateBranch(event.target.value)}
              value={session.branch}
            />
            {session.source !== "branch" && !session.branchEdited ? (
              <Badge variant="secondary">
                {t("worktree.create.autoBadge")}
              </Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.locationLabel")}
          </span>
          <span className="font-mono text-muted-foreground text-xs">
            {`.worktrees/${session.name}`}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.baseLabel")}
          </span>
          <Select
            disabled={creating}
            onValueChange={(value) => {
              setWorktreeCreateBase(value === HEAD_SENTINEL ? null : value);
            }}
            value={session.baseBranch ?? HEAD_SENTINEL}
          >
            <SelectTrigger className="h-6 w-fit font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HEAD_SENTINEL}>
                {t("worktree.create.baseHead")}
              </SelectItem>
              {session.branches.map((ref) => (
                <SelectItem key={`${ref.kind}:${ref.name}`} value={ref.name}>
                  {ref.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-xs">
            {t("worktree.create.prepareLabel")}
          </span>
          <span className="flex flex-wrap gap-1">
            {session.copyPatternCount > 0 ? (
              <Badge variant="outline">
                {t("worktree.create.prepareCopy", {
                  count: session.copyPatternCount,
                })}
              </Badge>
            ) : null}
            {session.setupCommand.trim() ? (
              <Badge variant="outline">
                {t("worktree.create.prepareSetup")}
              </Badge>
            ) : null}
            {session.copyPatternCount === 0 && !session.setupCommand.trim() ? (
              <span className="text-muted-foreground text-xs">
                {t("worktree.create.prepareNone")}
              </span>
            ) : null}
          </span>
        </div>
        {session.error ? (
          <p className="text-destructive text-xs">{session.error}</p>
        ) : null}
        <div className="flex items-center gap-4 text-muted-foreground text-xs">
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
          <span className="ml-auto">{t("worktree.create.emptyHint")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
