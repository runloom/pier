import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Stack,
  Text,
} from "pier/canvas";
import { host } from "pier/host";
import { useMemo, useState } from "react";
import { HostDomainDocs } from "./host-domain.tsx";
import { DocCode, DocSection } from "./host-docs.tsx";
import { CanvasFileApiDocs } from "./host-file-api.tsx";

type CatalogSelection =
  | { kind: "domain"; id: string }
  | { kind: "file-api" };

interface InventoryEntry {
  lead: string;
  name: string;
  selection: CatalogSelection;
}

function catalogKey(selection: CatalogSelection): string {
  return selection.kind === "file-api" ? "file-api" : `domain:${selection.id}`;
}

function domainLead(
  domain: ReturnType<typeof host.inspect>["domains"][number]
): string {
  const parts: string[] = [];
  if (domain.commands.length > 0) {
    parts.push(`${domain.commands.length} 条命令`);
  }
  if (domain.channels.length > 0) {
    parts.push(`${domain.channels.length} 个广播`);
  }
  if (domain.snapshots.length > 0) {
    parts.push(`${domain.snapshots.length} 个快照`);
  }
  return parts.join(" · ");
}

export function HostApiPage() {
  const inspect = useMemo(() => host.inspect(), []);
  const entries = useMemo<InventoryEntry[]>(
    () => [
      {
        lead: "读写画布旁边的文件，含冲突；不是全局 file 命令",
        name: "useCanvasFile",
        selection: { kind: "file-api" },
      },
      ...inspect.domains.map((domain) => ({
        lead: domainLead(domain),
        name: domain.id,
        selection: { kind: "domain" as const, id: domain.id },
      })),
    ],
    [inspect]
  );
  const [selected, setSelected] = useState<CatalogSelection>({
    kind: "file-api",
  });
  const selectedDomain =
    selected.kind === "domain"
      ? inspect.domains.find((domain) => domain.id === selected.id)
      : undefined;

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <Text as="h2" className="text-base font-semibold">
          API
        </Text>
        <Text className="text-sm leading-relaxed" tone="secondary">
          按能力查阅。相邻文件是 `useCanvasFile`；其余域走 `pier/host`。不要用
          window.pier。
        </Text>
      </Stack>
      <DocSection title="安装">
        <DocCode>{'import { useCanvasFile } from "pier/canvas"'}</DocCode>
        <DocCode>{'import { host, useHostSnapshot } from "pier/host"'}</DocCode>
      </DocSection>
      <DocSection title="签名">
        <DocCode
        >{`host.invoke(command: CanvasHostCommand): Promise<unknown>
function useHostSnapshot(target: CanvasHostWatchTarget): HostSnapshotState
host.subscribe(channel: CanvasHostChannel, listener: (payload: unknown) => void): () => void
host.inspect(): CanvasHostInspect`}</DocCode>
      </DocSection>
      <DocSection title="用法">
        <DocCode
        >{`await host.invoke({
  type: "file.list",
  root: workspaceRoot,
  path: ".",
})`}</DocCode>
      </DocSection>
      <div className="grid items-start gap-6 md:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
        <ItemGroup className="gap-2">
          {entries.map((entry) => {
            const selectedRow =
              catalogKey(entry.selection) === catalogKey(selected);
            return (
              <li key={catalogKey(entry.selection)}>
                <Item
                  asChild
                  className={selectedRow ? "ring-1 ring-ring/40" : undefined}
                  size="sm"
                  variant="outline"
                >
                  <button
                    aria-pressed={selectedRow}
                    className="w-full text-left"
                    onClick={() => setSelected(entry.selection)}
                    type="button"
                  >
                    <ItemContent>
                      <ItemTitle className="font-mono">{entry.name}</ItemTitle>
                      <ItemDescription>{entry.lead}</ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              </li>
            );
          })}
        </ItemGroup>
        <div aria-label="API 详情" className="min-w-0" role="region">
          {selected.kind === "file-api" ? <CanvasFileApiDocs /> : null}
          {selectedDomain ? <HostDomainDocs domain={selectedDomain} /> : null}
        </div>
      </div>
    </Stack>
  );
}
