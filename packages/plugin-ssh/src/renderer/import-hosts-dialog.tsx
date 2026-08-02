import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { DIALOG_FOOTER_ACTIONS_CLASS } from "@pier/ui/dialog-form-layout.ts";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { scrollFadeClassName } from "@pier/ui/scroll-area.tsx";
import { cn } from "@pier/ui/utils.ts";
import { Fragment, type JSX, useLayoutEffect, useRef, useState } from "react";
import { describeSshTarget, type SshHost } from "../shared/hosts.ts";
import type { Translate } from "./translate.ts";

const IMPORT_DIALOG_ID = "hosts.import";

interface ImportContentProps extends RendererPluginContentDialogRenderProps {
  candidates: readonly SshHost[];
  context: ExternalRendererPluginContext;
  onError: (error: unknown) => void;
  t: Translate;
}

function ImportContent({
  candidates,
  close,
  context,
  onError,
  setFooter,
  t,
}: ImportContentProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(candidates.map((candidate) => candidate.id))
  );
  const [importing, setImporting] = useState(false);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const toggle = (hostId: string, checked: boolean): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(hostId);
      } else {
        next.delete(hostId);
      }
      return next;
    });
  };

  useLayoutEffect(() => {
    setFooter(
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          disabled={importing}
          onClick={() => close(null)}
          type="button"
          variant="outline"
        >
          {t("pier.ssh.hosts.settings.cancel", "Cancel")}
        </Button>
        <Button
          disabled={importing || selectedIds.size === 0}
          onClick={() => {
            const hosts = candidates.filter((candidate) =>
              selectedIdsRef.current.has(candidate.id)
            );
            if (hosts.length === 0) {
              close(null);
              return;
            }
            setImporting(true);
            context.rpc
              .invoke("hosts.import", { hosts })
              .then(() => {
                close(hosts.length);
              })
              .catch((error: unknown) => {
                setImporting(false);
                onError(error);
              });
          }}
          type="button"
        >
          {t("pier.ssh.import.confirm", "Import selected")}
        </Button>
      </div>
    );
    return () => {
      setFooter(null);
    };
  }, [
    candidates,
    close,
    context.rpc,
    importing,
    onError,
    selectedIds.size,
    setFooter,
    t,
  ]);

  return (
    <div className="flex flex-col gap-4" data-slot="dialog-commit-form">
      <ItemGroup
        className={cn(
          "max-h-72 gap-0 overflow-y-auto rounded-md border",
          scrollFadeClassName({ fade: "vertical", profile: "short" })
        )}
      >
        {candidates.map((candidate, index) => (
          <Fragment key={candidate.id}>
            {index > 0 ? <ItemSeparator /> : null}
            <Item asChild size="sm">
              <label htmlFor={`pier-ssh-import-${candidate.id}`}>
                <Checkbox
                  checked={selectedIds.has(candidate.id)}
                  id={`pier-ssh-import-${candidate.id}`}
                  onCheckedChange={(checked) =>
                    toggle(candidate.id, checked === true)
                  }
                />
                <ItemContent className="min-w-0">
                  <ItemTitle>{candidate.name}</ItemTitle>
                  <ItemDescription className="font-mono text-xs">
                    {describeSshTarget(candidate)}
                  </ItemDescription>
                </ItemContent>
              </label>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </div>
  );
}

export async function openImportHostsDialog(options: {
  context: ExternalRendererPluginContext;
  onError: (error: unknown) => void;
  t: Translate;
}): Promise<void> {
  const { context, onError, t } = options;
  const result = await context.rpc.invoke<{ candidates: SshHost[] }>(
    "hosts.importCandidates"
  );
  if (result.candidates.length === 0) {
    context.notifications.info(
      t("pier.ssh.import.none", "No new hosts found in ~/.ssh/config.")
    );
    return;
  }
  context.dialogs.open({
    content: (renderProps) => (
      <div className="contents" data-pier-ssh-scope="">
        <ImportContent
          {...renderProps}
          candidates={result.candidates}
          context={context}
          onError={onError}
          t={t}
        />
      </div>
    ),
    description: t(
      "pier.ssh.import.description",
      "Hosts found in ~/.ssh/config. Imported entries connect through your ssh config, so jump hosts and identity files keep working."
    ),
    id: IMPORT_DIALOG_ID,
    title: t("pier.ssh.import.title", "Import SSH hosts"),
  });
}
