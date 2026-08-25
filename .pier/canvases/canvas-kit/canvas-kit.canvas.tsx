import {
  Frame,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "pier/canvas";
import { useState } from "react";
import { ControlsPage } from "./controls.tsx";
import { DataPage } from "./data.tsx";
import { HostApiPage } from "./host.tsx";
import { LayoutPage } from "./layout.tsx";
import { VizPage } from "./viz.tsx";

/**
 * Temporary in-repo catalog for canvas blocks. Settings does not list
 * materials; later this catalog moves to the public docs site.
 */
export const canvas = {
  description:
    "Pier 自带的画布积木。每个积木都有实样和安装语句；完整文档后续放到官网。",
  kind: "kit" as const,
  title: "画布物料",
};

export default function CanvasKit() {
  const [tab, setTab] = useState("layout");
  return (
    <Frame maxWidth={1080}>
      <Stack gap={16}>
        <Stack gap={6}>
          <Text as="h1" className="text-2xl font-semibold tracking-tight">
            画布物料
          </Text>
          <Text className="max-w-3xl text-sm leading-relaxed" tone="secondary">
            从 `pier/canvas` 和 `pier/host` 组合页面。布局、控件、图示是积木实样；API
            是能力目录（签名、用法、字段），没有实样井。设置里不再放物料目录；完整说明后续会放到官网文档。
          </Text>
        </Stack>
        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="layout">布局</TabsTrigger>
            <TabsTrigger value="control">控件</TabsTrigger>
            <TabsTrigger value="viz">图示</TabsTrigger>
            <TabsTrigger value="data">数据</TabsTrigger>
            <TabsTrigger value="host">API</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-5" value="layout">
            <LayoutPage />
          </TabsContent>
          <TabsContent className="mt-5" value="control">
            <ControlsPage />
          </TabsContent>
          <TabsContent className="mt-5" value="viz">
            <VizPage />
          </TabsContent>
          <TabsContent className="mt-5" value="host">
            <HostApiPage />
          </TabsContent>
          <TabsContent className="mt-5" value="data">
            <DataPage />
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
