import {
  Badge,
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
import { DesignPage } from "./design-sections.tsx";
import { LandingPage } from "./landing-sections.tsx";
import { parseScheme, type SchemeData } from "./model.ts";
import { OverviewPage, ProblemPage } from "./overview-sections.tsx";
import { StatusBadge } from "./shared.tsx";

export const canvas = {
  description:
    "设置→项目一个物料列表：类型只做筛选，系统与项目混排，页面仍是文件。数据走宿主 stub；不拆工作台网格。",
  kind: "composition" as const,
  title: "Canvas 物料金标准",
};

export default function CanvasMaterialsGold() {
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
        <Empty className="min-h-64 py-12" role="status">
          <EmptyHeader>
            <EmptyMedia>
              <StatusIcon kind="error" />
            </EmptyMedia>
            <EmptyTitle>无法加载物料方案</EmptyTitle>
            <EmptyDescription className="whitespace-pre-wrap text-left">
              {error ?? "data.json 无效"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Frame>
    );
  }

  const d = payload.data;
  return (
    <Frame maxWidth={1080}>
      <Stack gap={14}>
        <header>
          <Stack gap={5}>
            <Row align="center" gap={8} wrap>
              <StatusBadge label={d.meta.status} />
              <Badge variant="outline">decision_nav_4</Badge>
              <Text className="font-mono text-xs text-muted-foreground">
                {d.meta.version} · {d.meta.researchCutoff}
              </Text>
            </Row>
            <Text
              as="h1"
              className="text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
            >
              {d.meta.title}
            </Text>
            <Text className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {d.meta.subtitle}
            </Text>
          </Stack>
        </header>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger className="whitespace-nowrap" value="overview">
              速览
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="problem">
              问题
            </TabsTrigger>
            <TabsTrigger className="whitespace-nowrap" value="design">
              设计
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
          <TabsContent className="mt-5" value="landing">
            <LandingPage d={d} />
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
