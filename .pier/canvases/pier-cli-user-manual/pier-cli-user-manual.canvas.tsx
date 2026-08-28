/**
 * 用户手册 · DocsShell（左 5 叶 + 右正文）
 */
import {
  Badge,
  Button,
  DocsShell,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Row,
  Skeleton,
  Stack,
  StatusIcon,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ContentPanel,
  type ContentFocus,
} from "./content-panel.tsx";
import {
  DEFAULT_NAV_ID,
  isNavId,
  NAV_LEAVES,
  type NavId,
} from "./nav.ts";
import type { ManualData, Payload } from "./types.ts";

export const canvas = {
  description:
    "Pier 本机 CLI 使用手册：DocsShell 文档壳（左 5 章 + 右正文）。",
  kind: "docs" as const,
  title: "Pier 本机 CLI 使用手册",
};

function parsePayload(raw: string): Payload {
  const parsed = JSON.parse(raw) as Payload;
  if (parsed.schemaVersion !== 1 || !parsed.data?.bluf) {
    throw new Error("data.json 需要 schemaVersion:1 与 data.bluf");
  }
  if (!parsed.data.domains || !parsed.data.tasks || !parsed.data.agents) {
    throw new Error("data.json 需要 domains / tasks / agents");
  }
  return parsed;
}

type SearchHit = {
  navId: NavId;
  label: string;
  focus?: ContentFocus;
};

function searchHits(data: ManualData, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const hits: SearchHit[] = [];

  if (
    data.meta.title.toLowerCase().includes(q) ||
    data.bluf.toLowerCase().includes(q) ||
    data.quickStart.prerequisite.toLowerCase().includes(q)
  ) {
    hits.push({ navId: "start", label: "开始 · 总览" });
  }

  for (const task of data.tasks) {
    if (
      task.title.toLowerCase().includes(q) ||
      task.when.toLowerCase().includes(q) ||
      task.steps.some((s) => s.toLowerCase().includes(q))
    ) {
      hits.push({
        navId: "tasks",
        label: `任务 · ${task.title}`,
        focus: { taskId: task.id },
      });
    }
  }

  for (const domain of data.domains) {
    if (domain.label.toLowerCase().includes(q)) {
      hits.push({
        navId: "reference",
        label: `参考 · ${domain.label}`,
        focus: { domainId: domain.id },
      });
    }
    for (const cmd of domain.commands) {
      if (
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
      ) {
        hits.push({
          navId: "reference",
          label: `${cmd.name} · ${domain.label}`,
          focus: { domainId: domain.id, commandId: cmd.id },
        });
      }
    }
  }

  for (const cmd of data.agents.shipped) {
    if (
      cmd.name.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    ) {
      hits.push({
        navId: "agents",
        label: `智能体 · ${cmd.name}`,
        focus: { commandId: cmd.id },
      });
    }
  }
  for (const cmd of data.agents.planned) {
    if (
      cmd.name.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    ) {
      hits.push({
        navId: "agents",
        label: `智能体 · ${cmd.name}（规划）`,
        focus: { commandId: cmd.id },
      });
    }
  }

  data.faq.forEach((item, index) => {
    if (
      item.q.toLowerCase().includes(q) ||
      item.a.toLowerCase().includes(q)
    ) {
      hits.push({
        navId: "help",
        label: `疑难 · ${item.q}`,
        focus: { faqIndex: index },
      });
    }
  });

  const seen = new Set<string>();
  return hits
    .filter((h) => {
      const key = `${h.navId}::${h.label}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

export default function PierCliUserManualCanvas() {
  const fileApi = useCanvasFile();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [navId, setNavId] = useState<NavId>(DEFAULT_NAV_ID);
  const [focus, setFocus] = useState<ContentFocus | undefined>();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const available = fileApi.available;
  const readSibling = fileApi.read;

  useEffect(() => {
    let cancelled = false;
    if (!available) {
      setLoading(false);
      setError(
        "当前 Canvas 没有相邻文件作用域。请从 Pier 项目文件树打开本手册。"
      );
      return;
    }
    setLoading(true);
    void readSibling("data.json")
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPayload(parsePayload(result.contents));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        const detail =
          reason instanceof Error ? reason.message : String(reason);
        setError(`${detail}\n\n检查相邻 data.json 是否完整。`);
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [available, readSibling]);

  const data = payload?.data;
  const trimmedQuery = query.trim();
  const hits = useMemo(
    () => (data ? searchHits(data, query) : []),
    [data, query]
  );
  const showSearchPanel = searchOpen && trimmedQuery.length > 0;

  useEffect(() => {
    if (!showSearchPanel) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setQuery("");
      }
    }
    function onPointer(event: MouseEvent) {
      const root = searchWrapRef.current;
      if (root && !root.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [showSearchPanel]);

  function goTo(next: NavId, nextFocus?: ContentFocus) {
    setNavId(next);
    setFocus(nextFocus);
    window.setTimeout(() => {
      mainRef.current
        ?.querySelector("h2")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  }

  if (loading) {
    return (
      <DocsShell
        nav={NAV_LEAVES}
        navId={DEFAULT_NAV_ID}
        onNavChange={() => undefined}
      >
        <Stack gap={10}>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </Stack>
      </DocsShell>
    );
  }

  if (error || !data) {
    return (
      <DocsShell
        nav={NAV_LEAVES}
        navId={DEFAULT_NAV_ID}
        onNavChange={() => undefined}
      >
        <Empty
          className="min-h-64 py-12"
          data-slot="manual-load-error-empty"
          role="status"
        >
          <EmptyHeader>
            <EmptyMedia>
              <StatusIcon kind="error" />
            </EmptyMedia>
            <EmptyTitle>无法加载使用手册</EmptyTitle>
            <EmptyDescription className="whitespace-pre-wrap text-left">
              {error ?? "data.json 无效"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </DocsShell>
    );
  }

  const header = (
    <Stack gap={8}>
      <Row align="center" gap={8} wrap>
        <Badge size="xs" variant="outline">
          {data.meta.version}
        </Badge>
      </Row>
      <Text as="h1" className="text-balance">
        {data.meta.title}
      </Text>
      <Text tone="secondary" className="max-w-2xl text-sm leading-relaxed">
        {data.meta.subtitle}
      </Text>
      <div className="relative max-w-md" ref={searchWrapRef}>
        <Input
          aria-controls="manual-search-results"
          aria-expanded={showSearchPanel}
          aria-label="搜索手册"
          placeholder="搜索命令或任务…"
          role="combobox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              return;
            }
            const first = hits[0];
            if (!first) {
              return;
            }
            event.preventDefault();
            goTo(first.navId, first.focus);
            setQuery("");
            setSearchOpen(false);
          }}
        />
        {showSearchPanel ? (
          <div
            aria-label="搜索结果"
            className="absolute top-full right-0 left-0 z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md"
            id="manual-search-results"
            role="listbox"
          >
            <Stack gap={0.5}>
              {hits.length === 0 ? (
                <Text
                  tone="secondary"
                  className="px-2 py-2 text-xs leading-relaxed"
                >
                  无匹配。试试命令名（如 panels list）或任务关键词。
                </Text>
              ) : (
                <>
                  {hits.map((hit) => (
                    <Button
                      className="h-auto w-full justify-start px-2 py-1.5 text-left font-normal text-xs"
                      key={`${hit.navId}-${hit.label}`}
                      role="option"
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        goTo(hit.navId, hit.focus);
                        setQuery("");
                        setSearchOpen(false);
                      }}
                    >
                      {hit.label}
                    </Button>
                  ))}
                  {hits.length >= 12 ? (
                    <Text tone="tertiary" className="px-2 py-1 text-xs">
                      仅显示前 12 条，请缩小关键词。
                    </Text>
                  ) : null}
                </>
              )}
            </Stack>
          </div>
        ) : null}
      </div>
    </Stack>
  );

  return (
    <DocsShell
      header={header}
      nav={NAV_LEAVES}
      navId={navId}
      onNavChange={(id) => {
        if (isNavId(id)) {
          goTo(id);
        }
      }}
    >
      <div ref={mainRef}>
        {focus ? (
          <ContentPanel data={data} focus={focus} navId={navId} />
        ) : (
          <ContentPanel data={data} navId={navId} />
        )}
      </div>
    </DocsShell>
  );
}
