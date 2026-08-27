import { Row, Stack, Text } from "pier/canvas";
import { AppNav, Band, Box, Chip } from "./chrome.tsx";

export function ScreenQR() {
  return (
    <Stack className="h-full" gap={0}>
      <Band title="桌面设置 · 远程访问（默认关）">
        <Box hi>
          <Row justify="space-between">
            <Text className="text-xs">允许移动端连接</Text>
            <Text className="text-[10px]">关 → 开</Text>
          </Row>
          <Text className="text-[10px]" tone="tertiary">
            本网接口可听直连。跨网只出站会合。不开放公网入站。
          </Text>
        </Box>
      </Band>
      <Band grow title="出示二维码">
        <Box>
          <Text className="text-xs">二维码区域</Text>
          <Text className="font-mono text-[10px]" tone="tertiary">
            pairingCode, fingerprint, relayHint
          </Text>
        </Box>
      </Band>
      <Band last title="已配对设备 · 按台吊销">
        <Box>
          <Row justify="space-between">
            <Text className="text-xs">设备名 · Web</Text>
            <Text className="border border-foreground px-1.5 py-0.5 text-[10px]">
              移除
            </Text>
          </Row>
          <Text className="text-[10px]" tone="tertiary">
            移除即吊销；已连会话立即断开。
          </Text>
        </Box>
      </Band>
    </Stack>
  );
}

export function ScreenH0() {
  return (
    <Stack className="h-full" gap={0}>
      <Band title="1 身份">
        <Text className="text-xs">Pier 移动端</Text>
        <Text className="text-[10px]" tone="secondary">
          还没有主机
        </Text>
      </Band>
      <Band grow title="2 空态">
        <Box hi>
          <Text className="text-xs">请先添加一台桌面宿主</Text>
        </Box>
        <Box>
          <Text className="bg-foreground py-1.5 text-center text-[11px] text-background">
            扫描二维码
          </Text>
        </Box>
        <Box dashed>
          <Text className="text-[10px]" tone="secondary">
            无相机时从相册选取
          </Text>
        </Box>
      </Band>
    </Stack>
  );
}

export function ScreenH1() {
  return (
    <Stack className="h-full" gap={0}>
      <Band title="1 标题">
        <Row justify="space-between">
          <Text className="text-xs">主机</Text>
          <Text className="border border-foreground px-1.5 py-0.5 text-[10px]">
            添加
          </Text>
        </Row>
      </Band>
      <Band grow title="2 已配对列表">
        <Box hi>
          <Row justify="space-between">
            <Text className="text-xs font-medium">开发机</Text>
            <Text className="text-[10px]">在线</Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            握手成功 · 进入工作台
          </Text>
        </Box>
        <Box>
          <Row justify="space-between">
            <Text className="text-xs">构建机</Text>
            <Text className="text-[10px]">离线</Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            令牌仍在 · 上次相对时间
          </Text>
        </Box>
      </Band>
      <AppNav active="hosts" />
    </Stack>
  );
}

export function ScreenH2() {
  return (
    <Stack className="h-full" gap={0}>
      <Band title="1 当前主机">
        <Row justify="space-between">
          <Text className="text-xs">‹ 主机 · 开发机</Text>
          <Text className="text-[10px]">在线</Text>
        </Row>
        <Text className="text-[10px]" tone="secondary">
          工作台只投影这一台
        </Text>
      </Band>
      <Band title="2 过滤 · 状态投影">
        <Row gap={4} wrap>
          <Chip on text="全部 n" />
          <Chip text="需要你处理 n" />
          <Chip text="运行中 n" />
          <Chip text="已完成" />
        </Row>
      </Band>
      <Band grow title="3 该机会话">
        <Box hi>
          <Row justify="space-between">
            <Text className="text-xs font-medium">会话标题</Text>
            <Text className="text-[10px]">需要你处理</Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            工作树 / 分支 · 去处理
          </Text>
        </Box>
        <Box>
          <Row justify="space-between">
            <Text className="text-xs">会话标题</Text>
            <Text className="text-[10px]">运行中</Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            工作树 · 摘要
          </Text>
        </Box>
        <Box>
          <Row justify="space-between">
            <Text className="text-xs">会话标题</Text>
            <Text className="text-[10px]">已完成</Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            +n −n · 查看变更 / 文件
          </Text>
        </Box>
      </Band>
      <AppNav active="sessions" />
    </Stack>
  );
}
