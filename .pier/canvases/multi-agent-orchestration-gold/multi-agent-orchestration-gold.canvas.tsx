import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Frame,
  Row,
  Skeleton,
  Stack,
  StatusIcon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useEffect, useState } from "react";
import { parseScheme, type SchemeData } from "./model.ts";
import { DesignPage, OverviewPage, ProblemPage } from "./overview-sections.tsx";
import { LandingPage, PathPage } from "./path-sections.tsx";
import { StatusBadge } from "./shared.tsx";

export const canvas = {
  description:
    "产品 CLI 服务本机用户（cli-human）：W0–W1 传输/发现已关账；agent binding 为遗留实验；invoke 与持久会话从 W2/W3 起实现。",
  kind: "composition" as const,
  title: "智能体优先的多智能体调用 CLI · 产品与技术方案",
};

export default function MultiAgentOrchestrationCanvas() {
  const fileApi = useCanvasFile();
  const [tab, setTab] = useState("overview");
  const [payload, setPayload] = useState<SchemeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const available = fileApi.available;
  const readSibling = fileApi.read;

  useEffect(() => {
    let cancelled = false;
    if (!available) {
      setLoading(false);
      setError(
        "当前 Canvas 没有相邻文件作用域，无法读取 data.json。请从 Pier 项目文件树打开本 Canvas。",
      );
      return;
    }
    setLoading(true);
    void readSibling("data.json")
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPayload(parseScheme(result.contents));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        const detail = reason instanceof Error ? reason.message : String(reason);
        setError(`${detail}\n\n下一步：检查相邻 data.json 的 schemaVersion 与必填数组。`);
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

  if (loading) {
    return (
      <Frame maxWidth={1080}>
        <Stack gap={10}>
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </Stack>
      </Frame>
    );
  }

  if (error || !payload) {
    return (
      <Frame maxWidth={1080}>
        <Empty
          className="min-h-64 py-12"
          data-slot="scheme-load-error-empty"
          role="status"
        >
          <EmptyHeader>
            <EmptyMedia>
              <StatusIcon kind="error" />
            </EmptyMedia>
            <EmptyTitle>无法加载智能体协作方案</EmptyTitle>
            <EmptyDescription className="whitespace-pre-wrap text-left">
              {error ?? "data.json 无效"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Frame>
    );
  }

  const d = payload.data;
  const researchVerified = d.acceptance.find((row) => row.id === "E0")?.status === "verified";
  const shortBaseline =
    d.meta.codeBaseline.length > 14
      ? `${d.meta.codeBaseline.slice(0, 12)}…`
      : d.meta.codeBaseline;
  return (
    <Frame maxWidth={1080}>
      <Stack gap={14}>
        <header>
          <Stack gap={5}>
            <Row align="center" gap={8} wrap>
              <StatusBadge label={d.meta.status} tone="info" />
              <StatusBadge
                label={researchVerified ? "三项调研已核对" : "三项调研待核对"}
                tone={researchVerified ? "success" : "warning"}
              />
              <Text tone="tertiary" className="font-mono text-xs">
                {d.meta.version} · {shortBaseline} · {d.meta.researchCutoff}
              </Text>
            </Row>
            <Text
              as="h1"
              className="text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
            >
              {d.meta.title}
            </Text>
            <Text tone="secondary" className="max-w-3xl text-sm leading-relaxed">
              {d.meta.subtitle}
            </Text>
          </Stack>
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto">
            <TabsTrigger className="whitespace-nowrap" value="overview">
              速览
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="problem">
              问题
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="design">
              设计
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="path">
              日路径
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="landing">
              落地
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-5" value="overview">
            <OverviewPage d={d} />
          </TabsContent>
          <TabsContent className="mt-5" value="problem">
            <ProblemPage d={d} />
          </TabsContent>
          <TabsContent className="mt-5" value="design">
            <DesignPage d={d} />
          </TabsContent>
          <TabsContent className="mt-5" value="path">
            <PathPage d={d} />
          </TabsContent>
          <TabsContent className="mt-5" value="landing">
            <LandingPage d={d} />
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
