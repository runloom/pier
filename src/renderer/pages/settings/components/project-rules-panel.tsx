import { Badge } from "@pier/ui/badge.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  RuleFileId,
  RuleFileView,
} from "@shared/contracts/agent/assets.ts";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  openUnderRoot,
  openUnderRootInPierEditor,
  revealUnderRoot,
} from "@/lib/files/shell-path-actions.ts";
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { ProjectRulesSelectedPane } from "./project-rules-panel-detail.tsx";
import {
  assetRootFor,
  isOversizeFile,
  RuleFileIcon,
  ruleFamilyLabel,
  ruleStateBadge,
} from "./project-rules-panel-helpers.tsx";

export function ProjectRulesPanel({
  discardName,
  isPierHome,
  onDirtyChange,
  projectRootPath,
  registerSave,
}: {
  discardName: string;
  isPierHome: boolean;
  onDirtyChange: (dirty: boolean) => void;
  projectRootPath: string;
  registerSave: (save: (() => Promise<void>) | null) => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<RuleFileView[]>([]);
  const [selectedId, setSelectedId] = useState<RuleFileId>("agents-md");
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const selected = files.find((f) => f.id === selectedId) ?? files[0];
  const oversize = truncated || (selected ? isOversizeFile(selected) : false);
  const readOnly = oversize;
  const dirty =
    contentReady &&
    !readOnly &&
    selected?.state === "file" &&
    content !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    const root = assetRootFor(projectRootPath, isPierHome);
    setLoading(true);
    window.pier.agentAssets.rules
      .snapshot(root)
      .then((snap) => {
        if (cancelled) return;
        setFiles(snap.files);
        const firstFile =
          snap.files.find((f) => f.state === "file")?.id ??
          snap.files[0]?.id ??
          "agents-md";
        setSelectedId(firstFile);
      })
      .catch((err: unknown) => {
        showAppAlert({
          title: t("settings.projects.rulesLoadFailed"),
          body: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRootPath, isPierHome, t]);

  useEffect(() => {
    let cancelled = false;
    if (!selected || selected.id !== selectedId || selected.state !== "file") {
      setContent("");
      setBaseline("");
      setTruncated(false);
      setContentReady(false);
      return;
    }
    const root = assetRootFor(projectRootPath, isPierHome);
    window.pier.agentAssets.rules
      .read(root, selectedId)
      .then((result) => {
        if (cancelled) return;
        setContent(result.content);
        setBaseline(result.content);
        setTruncated(result.truncated);
        setContentReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        showAppAlert({
          title: t("settings.projects.rulesLoadFailed"),
          body: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected, projectRootPath, isPierHome, t]);

  useEffect(() => {
    const root = assetRootFor(projectRootPath, isPierHome);
    const save = async () => {
      if (selected?.state !== "file" || !dirty || readOnly || !contentReady) {
        return;
      }
      await window.pier.agentAssets.rules.write(root, selected.id, content);
      const snap = await window.pier.agentAssets.rules.snapshot(root);
      setFiles(snap.files);
      setBaseline(content);
      setTruncated(false);
    };
    registerSave(dirty ? save : null);
    return () => {
      registerSave(null);
    };
  }, [
    dirty,
    readOnly,
    contentReady,
    content,
    selected,
    projectRootPath,
    isPierHome,
    registerSave,
  ]);

  async function selectFile(nextId: RuleFileId) {
    if (nextId === selectedId) return;
    if (dirtyRef.current) {
      const ok = await showAppConfirm({
        title: t("settings.projects.rulesDiscardTitle"),
        body: t("settings.projects.rulesDiscardBody", { name: discardName }),
        intent: "destructive",
      });
      if (!ok) return;
    }
    setContent("");
    setBaseline("");
    setTruncated(false);
    setContentReady(false);
    setSelectedId(nextId);
  }

  async function openExternal(relativePath: string) {
    const result = await openUnderRoot(projectRootPath, relativePath);
    if (!result.ok) {
      await showAppAlert({
        title: t("settings.projects.rulesOpenFailed"),
        body: result.reason,
      });
    }
  }

  function openInPier(relativePath: string, title?: string) {
    const result = openUnderRootInPierEditor(
      projectRootPath,
      relativePath,
      title
    );
    if (!result.ok) {
      showAppAlert({
        title: t("settings.projects.rulesOpenFailed"),
        body: result.reason,
      }).catch(() => undefined);
    }
  }

  async function createMissing(id: RuleFileId) {
    const root = assetRootFor(projectRootPath, isPierHome);
    const ok = await showAppConfirm({
      title: t("settings.projects.rulesEnsureTitle"),
      body: t("settings.projects.rulesEnsureBody", {
        name: files.find((f) => f.id === id)?.relativePath ?? id,
      }),
      intent: "default",
    });
    if (!ok) return;
    try {
      const snap = await window.pier.agentAssets.rules.ensure(root, id);
      setFiles(snap.files);
      setSelectedId(id);
    } catch (err) {
      await showAppAlert({
        title: t("settings.projects.rulesEnsureFailed"),
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function revealPath(relativePath: string) {
    const result = await revealUnderRoot(projectRootPath, relativePath);
    if (!result.ok) {
      await showAppAlert({
        title: t("settings.projects.rulesRevealFailed"),
        body: result.reason,
      });
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("settings.projects.rulesHint")}
      </p>
      <div className="flex min-h-[280px] gap-0 overflow-hidden rounded-lg border">
        <nav
          aria-label={t("settings.projects.rulesFileListLabel")}
          className={cn(
            "w-64 shrink-0 overflow-y-auto border-r p-2",
            scrollFadeClassName({ fade: "vertical", profile: "short" })
          )}
        >
          <ItemGroup>
            {files.map((file) => {
              const on = file.id === selectedId;
              const badge = ruleStateBadge(file, t);
              return (
                <li key={file.id}>
                  <Item
                    asChild
                    className={cn(on && "ring-1 ring-border")}
                    size="sm"
                    variant={on ? "muted" : "outline"}
                  >
                    <button
                      aria-current={on ? "true" : undefined}
                      className="w-full text-left"
                      onClick={() => {
                        selectFile(file.id).catch(() => undefined);
                      }}
                      type="button"
                    >
                      <ItemMedia variant="icon">
                        <RuleFileIcon state={file.state} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="max-w-full">
                          <span className="truncate font-mono text-xs">
                            {file.relativePath}
                          </span>
                          <Badge size="xs" variant={badge.variant}>
                            {badge.label}
                          </Badge>
                        </ItemTitle>
                        <ItemDescription className="line-clamp-1">
                          {ruleFamilyLabel(file.id, t)}
                        </ItemDescription>
                      </ItemContent>
                    </button>
                  </Item>
                </li>
              );
            })}
          </ItemGroup>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <ProjectRulesSelectedPane
            content={content}
            contentReady={contentReady}
            onChangeContent={setContent}
            onCreateMissing={(id) => {
              createMissing(id).catch(() => undefined);
            }}
            onOpenExternal={(relativePath) => {
              openExternal(relativePath).catch(() => undefined);
            }}
            onOpenInPier={openInPier}
            onRevealPath={(relativePath) => {
              revealPath(relativePath).catch(() => undefined);
            }}
            oversize={oversize}
            readOnly={readOnly}
            selected={selected}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
