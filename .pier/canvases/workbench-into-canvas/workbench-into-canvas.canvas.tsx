import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  useCanvasFile,
} from "pier/canvas";
import { useEffect, useState } from "react";
import { MaterialUiGallery } from "./product-frames.tsx";
import { H2, Lines, PageLead } from "./ui-frames.tsx";

export const canvas = {
  description:
    "Canvas 物料体系：现有清单、系统块、项目物料、统一管理、Skill 可发现。",
  kind: "composition" as const,
  title: "Canvas 物料体系",
};

type Core = { id: string; title: string; now: string; end: string };

type Doc = {
  bluf: string;
  context: string;
  goals: string[];
  nonGoals: string[];
  design: {
    oneLiner: string;
    fiveCores: Core[];
    inventoryNow: {
      l0: { import: string; status: string; items: string[]; excluded: string };
      l1: { import: string; status: string; candidates: string[] };
      l2: { import: string; status: string; note: string };
    };
    catalogShape: Record<string, string>;
    assemble: string;
    skill: { today: string; end: string; artifact: string };
    product: {
      screens: { id: string; name: string; shell: string }[];
      persist: {
        l0: string;
        l1: string;
        l2: string;
        skillSnapshot: string;
      };
      milestones: { id: string; title: string; deliver: string }[];
      acceptance: string[];
    };
    ergonomics: { problem: string; cut: string[]; keep: string[] };
  };
  alternatives: { name: string; rejectReason: string }[];
};

export default function CanvasMaterialsOverview() {
  const fileApi = useCanvasFile();
  const [tab, setTab] = useState("overview");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!fileApi.available) {
      setLoading(false);
      setError("没有相邻文件作用域。请从项目文件树打开本 Canvas。");
      return;
    }
    void fileApi
      .read("data.json")
      .then((result) => {
        if (cancelled) {
          return;
        }
        const parsed = JSON.parse(result.contents) as Doc;
        if (!parsed.bluf || !parsed.design) {
          throw new Error("data.json 缺少 bluf / design。");
        }
        if (
          !parsed.design.product?.milestones?.length ||
          !parsed.design.product.acceptance?.length
        ) {
          throw new Error("data.json 缺少 product.milestones / acceptance。");
        }
        setDoc(parsed);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setDoc(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileApi.available, fileApi.read]);

  if (loading) {
    return (
      <Frame maxWidth={840}>
        <Stack gap={10}>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-24 w-full" />
        </Stack>
      </Frame>
    );
  }

  if (error || !doc) {
    return (
      <Frame maxWidth={840}>
        <Empty className="py-10" role="status">
          <EmptyHeader>
            <EmptyMedia>
              <StatusIcon kind="error" />
            </EmptyMedia>
            <EmptyTitle>无法加载方案</EmptyTitle>
            <EmptyDescription>{error ?? "data.json 无效"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Frame>
    );
  }

  const inv = doc.design.inventoryNow;

  return (
    <Frame maxWidth={840}>
      <Stack gap={14}>
        <Stack gap={6}>
          <Row gap={8} wrap>
            <Badge variant="info">产品方案</Badge>
            <Badge variant="outline">物料体系</Badge>
            <Badge variant="outline">decision_nav_4</Badge>
          </Row>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            Canvas 物料
          </Text>
          <Text tone="secondary" className="text-sm leading-relaxed">
            生成页面时组装什么、谁登记、Skill 怎么知道。
          </Text>
        </Stack>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="overview">速览</TabsTrigger>
            <TabsTrigger value="problem">问题</TabsTrigger>
            <TabsTrigger value="design">设计</TabsTrigger>
            <TabsTrigger value="landing">落地</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="overview">
            <Stack gap={14}>
              <PageLead answers="五件事：现有清单、系统块、项目块、人只维护 L2、Skill 读目录。" />

              <Card className="border-status-info/30 bg-status-info/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">结论</CardTitle>
                </CardHeader>
                <CardContent>
                  <Text className="text-sm leading-relaxed">{doc.bluf}</Text>
                </CardContent>
              </Card>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>核心</TableHead>
                    <TableHead>现在</TableHead>
                    <TableHead>终态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.design.fiveCores.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm font-medium">
                        {c.id} {c.title}
                      </TableCell>
                      <TableCell className="text-sm">{c.now}</TableCell>
                      <TableCell className="text-sm">{c.end}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Text className="text-sm leading-relaxed">
                {doc.design.oneLiner}
              </Text>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="problem">
            <Stack gap={14}>
              <PageLead answers="今天 Canvas 到底能用什么，缺什么。" />

              <Text className="text-sm leading-relaxed">{doc.context}</Text>

              <H2>1. 现有可用（L0）</H2>
              <Text className="text-sm leading-relaxed">
                import {inv.l0.import} · {inv.l0.status}
              </Text>
              <Lines items={inv.l0.items} />
              <Text tone="secondary" className="text-sm leading-relaxed">
                明确不在白名单：{inv.l0.excluded}
              </Text>

              <H2>2. 系统物料（L1）缺口</H2>
              <Text className="text-sm leading-relaxed">
                import {inv.l1.import} · {inv.l1.status}
              </Text>
              <Lines items={inv.l1.candidates} />

              <H2>3. 项目物料（L2）无目录</H2>
              <Text className="text-sm leading-relaxed">
                {inv.l2.import} · {inv.l2.status}。{inv.l2.note}
              </Text>

              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">做</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Lines items={doc.goals} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">不做</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Lines items={doc.nonGoals} />
                  </CardContent>
                </Card>
              </div>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="design">
            <Stack gap={16}>
              <PageLead answers="为何砍屏、人只做什么、三块界面。" />

              <H2>为什么要砍</H2>
              <Text className="text-sm leading-relaxed">
                {doc.design.ergonomics.problem}
              </Text>
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">去掉</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Lines items={doc.design.ergonomics.cut} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">留下</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Lines items={doc.design.ergonomics.keep} />
                  </CardContent>
                </Card>
              </div>

              <H2>人的路径</H2>
              <Lines
                items={[
                  "日常：不用打开目录。生成交给 /pier-canvas。",
                  "偶发：声明或移除一条项目物料。",
                  "入口：设置 → 项目 → 常规，或命令「声明 Canvas 物料」。",
                ]}
              />

              <H2>屏幕清单</H2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>屏幕</TableHead>
                    <TableHead>壳</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.design.product.screens.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm font-medium">{s.id}</TableCell>
                      <TableCell className="text-sm">{s.name}</TableCell>
                      <TableCell className="text-sm">{s.shell}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <H2>组装合同</H2>
              <Text className="text-sm leading-relaxed">
                {doc.design.assemble}
              </Text>

              <H2>catalog 字段</H2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>字段</TableHead>
                    <TableHead>含义</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(doc.design.catalogShape).map(([k, v]) => (
                    <TableRow key={k}>
                      <TableCell className="font-mono text-xs">{k}</TableCell>
                      <TableCell className="text-sm">{v}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <H2>Skill</H2>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">生成前读目录</CardTitle>
                  <CardDescription>{doc.design.skill.artifact}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Stack gap={6}>
                    <Text className="text-sm leading-relaxed">
                      现在：{doc.design.skill.today}
                    </Text>
                    <Text className="text-sm leading-relaxed">
                      终态：{doc.design.skill.end}
                    </Text>
                  </Stack>
                </CardContent>
              </Card>

              <MaterialUiGallery />

              <H2>备选</H2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>方案</TableHead>
                    <TableHead>处理</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.alternatives.map((a) => (
                    <TableRow key={a.name}>
                      <TableCell className="text-sm font-medium">
                        {a.name}
                      </TableCell>
                      <TableCell className="text-sm">{a.rejectReason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          </TabsContent>

          <TabsContent className="mt-4" value="landing">
            <Stack gap={14}>
              <PageLead answers="按五条核心落地，不先拆工作台。" />

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>阶段</TableHead>
                    <TableHead>交付</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.design.product.milestones.map((step) => (
                    <TableRow key={step.id}>
                      <TableCell className="text-sm font-medium">
                        {step.id} {step.title}
                      </TableCell>
                      <TableCell className="text-sm">{step.deliver}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <H2>验收</H2>
              <Lines items={doc.design.product.acceptance} />

              <H2>落盘</H2>
              <Lines
                items={[
                  `L0：${doc.design.product.persist.l0}`,
                  `L1：${doc.design.product.persist.l1}`,
                  `L2：${doc.design.product.persist.l2}`,
                  `Skill：${doc.design.product.persist.skillSnapshot}`,
                ]}
              />

              <H2>和工作台的关系</H2>
              <Text className="text-sm leading-relaxed">
                工作台物料是 L1 的实现库存，不是本方案的产品中心。先让
                Canvas 能登记、发现、组装；是否拆除工作台网格另议。
              </Text>
            </Stack>
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
