import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Text,
} from "pier/canvas";
import {
  DialogChrome,
  ExistingCard,
  FooterPair,
  PaletteChrome,
  Screen,
  SettingsProjectFrame,
  STAGE,
} from "./chrome.tsx";

function GeneralStack({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProjectFrame>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ExistingCard
          description="可预览 *.canvas.* 的项目相对路径。未改过时为 .pier/canvases 与 docs。"
          title="画布预览目录"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            <Input aria-label="目录 1" defaultValue=".pier/canvases" readOnly />
            <Input aria-label="目录 2" defaultValue="docs" readOnly />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 10,
            }}
          >
            <Text tone="tertiary" className="text-xs">
              添加 · 恢复默认
            </Text>
            <Text tone="tertiary" className="text-xs">
              保存
            </Text>
          </div>
        </ExistingCard>
        {children}
        <ExistingCard
          description="技能安装产生的链接一般不必提交。"
          title="Git 忽略建议"
        />
      </div>
    </SettingsProjectFrame>
  );
}

function MaterialCard({ empty }: { empty?: boolean }) {
  return (
    <Card className="border-status-info/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Canvas 物料</CardTitle>
        <CardDescription>
          {empty
            ? "还没有项目物料。系统原语生成时可用；要把仓库组件编进页面，声明一条即可。"
            : "供 /pier-canvas 组装页面。系统原语无需登记。"}
        </CardDescription>
        <Text tone="tertiary" className="text-xs">
          系统块：活动、资源、成本 · 尚未接入
        </Text>
      </CardHeader>
      {empty ? null : (
        <CardContent className="pb-3">
          <Item variant="outline">
            <ItemContent>
              <ItemTitle>ReviewBoard</ItemTitle>
              <ItemDescription className="font-mono">
                @/canvas-materials/review-board
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" variant="outline">
                移除
              </Button>
            </ItemActions>
          </Item>
        </CardContent>
      )}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 14px 12px",
        }}
      >
        <Button type="button">声明物料</Button>
      </div>
    </Card>
  );
}

export function ScreenProjectCard() {
  return (
    <Screen
      id="U1"
      title="项目常规里的一张卡"
      spec="插在现有「画布预览目录」下面。人只管理 L2。L0 不展示。L1 一行状态。行内删除。声明走提交型弹窗。"
    >
      <GeneralStack>
        <MaterialCard />
      </GeneralStack>
    </Screen>
  );
}

export function ScreenProjectEmpty() {
  return (
    <Screen
      id="U1b"
      title="同一张卡 · 空"
      spec="零项目物料时不要整页空态。卡内一句话 + 一个按钮。设置壳不变。"
    >
      <GeneralStack>
        <MaterialCard empty />
      </GeneralStack>
    </Screen>
  );
}

export function ScreenDeclare() {
  return (
    <Screen
      id="U2"
      title="声明（两个字段）"
      spec="走宿主 content dialog：垂直字段，提交才写入。id 由导出名生成。校验写在字段下。"
    >
      <DialogChrome
        description="登记仓库组件，生成 Canvas 时可以 import。不会加入工作台。"
        footer={<FooterPair primary="声明" />}
        title="声明项目物料"
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel>模块</FieldLabel>
            <Input
              aria-label="模块"
              defaultValue="@/canvas-materials/review-board"
            />
            <FieldDescription>Live Modules 能解析的路径。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>导出组件</FieldLabel>
            <Input aria-label="导出组件" defaultValue="ReviewBoard" />
            <FieldDescription>标识将是 l2.review-board</FieldDescription>
          </Field>
        </FieldGroup>
      </DialogChrome>
    </Screen>
  );
}

export function ScreenCommand() {
  return (
    <Screen
      id="U3"
      title="命令：一条主入口"
      spec="命令面板现有壳。默认只暴露「声明 Canvas 物料」。打开设置是次要命中，不必再加第三条。"
    >
      <PaletteChrome query="声明物料">
        <div style={{ padding: "6px 10px 4px" }}>
          <Text tone="tertiary" className="text-xs">
            搜索结果
          </Text>
        </div>
        <div
          style={{
            ...STAGE,
            background: "var(--muted)",
            border: "none",
            borderRadius: 8,
            display: "flex",
            justifyContent: "space-between",
            margin: "0 8px 4px",
            padding: "8px 10px",
          }}
        >
          <Text className="text-sm">声明 Canvas 物料</Text>
          <Badge variant="outline">项目</Badge>
        </div>
        <div style={{ padding: "6px 10px 4px" }}>
          <Text tone="tertiary" className="text-xs">
            设置
          </Text>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 18px 12px",
          }}
        >
          <Text className="text-sm">打开设置</Text>
          <Text tone="tertiary" className="text-xs">
            常规
          </Text>
        </div>
      </PaletteChrome>
    </Screen>
  );
}
