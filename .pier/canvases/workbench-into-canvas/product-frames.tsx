import { Stack, Text } from "pier/canvas";
import {
  ScreenCommand,
  ScreenDeclare,
  ScreenProjectCard,
  ScreenProjectEmpty,
} from "./screens.tsx";

export function MaterialUiGallery() {
  return (
    <Stack gap={18}>
      <Stack gap={4}>
        <Text as="h2" className="text-base font-medium tracking-tight">
          精简后的界面
        </Text>
        <Text tone="secondary" className="text-sm leading-relaxed">
          接到现有 Pier：设置 → 项目 → 常规，插在「画布预览目录」下面。声明走
          content dialog。命令走现有命令面板。生成仍只走 /pier-canvas。
        </Text>
      </Stack>
      <ScreenProjectCard />
      <ScreenProjectEmpty />
      <ScreenDeclare />
      <ScreenCommand />
    </Stack>
  );
}
