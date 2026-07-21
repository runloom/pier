import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_ROOTS = [
  join(ROOT, "src", "renderer"),
  join(ROOT, "src", "plugins", "builtin"),
  join(ROOT, "packages", "plugin-codex", "src", "renderer"),
];
const RAW_BUTTON_OWNERS = new Set([
  // shadcn SidebarRail 的上游实现需要独立命中区域。
  "src/renderer/components/primitives/sidebar.tsx",
  // Dockview tab action 必须保留其原生 class 与事件边界。
  "src/renderer/components/workspace/panel-tab-header.tsx",
  // 工作台显式拖拽抓手属于网格几何交互，不是普通业务按钮。
  "src/renderer/panel-kits/workbench/workbench-widget-card.tsx",
  // 物料添加卡与物料预览卡属于响应式网格中的专用几何表面。
  "src/renderer/panel-kits/workbench/workbench-add-card.tsx",
  // 活动列表和物料库预览卡需要保持卡内响应式几何与整面点击区域。
  "src/renderer/panel-kits/workbench/core-widgets/activity-widget.tsx",
  "src/renderer/panel-kits/workbench/workbench-library-dialog.tsx",
  // 环境列表按钮由 Item asChild 提供视觉和交互原语。
  "src/renderer/pages/settings/components/environment-section.tsx",
  // 技能项目列表同上。
  "src/renderer/pages/settings/components/skills/skills-project-list.tsx",
]);
const ITEM_AS_CHILD_BUTTON_OWNERS = new Set([
  "src/renderer/pages/settings/components/environment-section.tsx",
  "src/renderer/pages/settings/components/skills/skills-project-list.tsx",
]);
const DETACHED_ITEM_HELPERS = new Map([
  [
    "src/renderer/components/common/command-palette-action-rows.tsx",
    "CommandGroup",
  ],
  [
    "src/renderer/components/common/command-palette-quick-pick-view.tsx",
    "CommandGroup",
  ],
  ["src/renderer/components/workspace/panel-overflow.tsx", "SelectGroup"],
  [
    "src/plugins/builtin/git/renderer/git-status-dropdown.tsx",
    "DropdownMenuGroup",
  ],
]);
const GROUP_BY_ITEM = new Map([
  ["CommandItem", "CommandGroup"],
  ["ContextMenuItem", "ContextMenuGroup"],
  ["DropdownMenuItem", "DropdownMenuGroup"],
  ["SelectItem", "SelectGroup"],
  ["TabsTrigger", "TabsList"],
]);
const ICON_CONTROL_OWNERS = new Set([
  "Alert",
  "Badge",
  "Button",
  "CommandItem",
  "ContextMenuItem",
  "DropdownMenuItem",
  "EmptyMedia",
  "ItemMedia",
  "SidebarMenuButton",
  "ToggleGroupItem",
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    if (statSync(filePath).isDirectory()) {
      files.push(...sourceFiles(filePath));
    } else if (entry.endsWith(".tsx")) {
      files.push(filePath);
    }
  }
  return files;
}

function projectRelative(filePath: string): string {
  return relative(ROOT, filePath).split(sep).join("/");
}

function jsxName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return ts.isJsxElement(node)
    ? node.openingElement.tagName.getText()
    : node.tagName.getText();
}

function descendantNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  function visit(child: ts.Node): void {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      names.add(jsxName(child));
    }
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return names;
}

function attribute(
  node: ts.JsxSelfClosingElement,
  name: string
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  );
}

describe("shadcn composition governance", () => {
  const files = SOURCE_ROOTS.flatMap(sourceFiles);

  it("documents the renderer composition boundary", () => {
    const context = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(context).toContain("### shadcn 组件使用规范");
    expect(context).toContain("AvatarFallback");
    expect(context).toContain("专用渲染");
  });

  it("forbids raw form controls and deprecated spacing shortcuts", () => {
    const offenders = files.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const reasons = [
        /<(?:input|select|textarea|hr)\b/.test(source) ? "raw control" : null,
        /\bspace-[xy]-/.test(source) ? "space utility" : null,
        /className=\{`/.test(source) ? "class template" : null,
      ].filter(Boolean);
      return reasons.map((reason) => `${projectRelative(filePath)}: ${reason}`);
    });
    expect(offenders).toEqual([]);
  });

  it("requires localized labels for visible dialog close buttons", () => {
    const offenders = files.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return [...source.matchAll(/<(?:Dialog|Sheet)Content\b[\s\S]*?>/g)]
        .filter(
          ([openingTag]) =>
            openingTag?.includes("showCloseButton") &&
            !openingTag.includes("showCloseButton={false}") &&
            !openingTag.includes("closeLabel=")
        )
        .map(() => projectRelative(filePath));
    });

    expect(offenders).toEqual([]);
  });

  it("keeps raw buttons behind Item or an explicit framework boundary", () => {
    const owners = files
      .filter((filePath) => /<button\b/.test(readFileSync(filePath, "utf8")))
      .map(projectRelative);
    expect(new Set(owners)).toEqual(RAW_BUTTON_OWNERS);
    for (const owner of ITEM_AS_CHILD_BUTTON_OWNERS) {
      expect(readFileSync(join(ROOT, owner), "utf8")).toMatch(
        /<Item[\s\S]{0,100}?asChild|<Item asChild/
      );
    }
  });

  it("requires complete titled Card and Avatar composition", () => {
    const offenders: string[] = [];
    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      function visit(node: ts.Node): void {
        if (ts.isJsxElement(node)) {
          const name = jsxName(node);
          const descendants = descendantNames(node);
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          if (
            name === "Card" &&
            ((descendants.has("CardHeader") &&
              !descendants.has("CardContent")) ||
              (descendants.has("CardTitle") && !descendants.has("CardHeader")))
          ) {
            offenders.push(`${projectRelative(filePath)}:${line}: Card`);
          }
          if (name === "Avatar" && !descendants.has("AvatarFallback")) {
            offenders.push(`${projectRelative(filePath)}:${line}: Avatar`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps settings page headings outside cards", () => {
    const settingsRoot = join(ROOT, "src", "renderer", "pages", "settings");
    const offenders: string[] = [];
    for (const filePath of sourceFiles(settingsRoot)) {
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const stack: string[] = [];
      function visit(node: ts.Node): void {
        const isElement = ts.isJsxElement(node);
        const name = isElement ? jsxName(node) : null;
        if (name) stack.push(name);
        if (name === "h1" && stack.includes("Card")) {
          const line =
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          offenders.push(`${projectRelative(filePath)}:${line}`);
        }
        ts.forEachChild(node, visit);
        if (name) stack.pop();
      }
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
  });

  it("preserves code semantics and dedicated widget geometry", () => {
    const environmentEditor = readFileSync(
      join(
        ROOT,
        "src/renderer/pages/settings/components/environment-editor.tsx"
      ),
      "utf8"
    );
    const environmentVariables = readFileSync(
      join(
        ROOT,
        "src/renderer/pages/settings/components/environment-vars-table.tsx"
      ),
      "utf8"
    );
    const agentRow = readFileSync(
      join(ROOT, "src/renderer/pages/settings/components/agent-row.tsx"),
      "utf8"
    );
    const widgetLibrary = readFileSync(
      join(
        ROOT,
        "src/renderer/panel-kits/workbench/workbench-library-dialog.tsx"
      ),
      "utf8"
    );

    expect(environmentEditor.match(/font-mono/g)).toHaveLength(2);
    expect(environmentVariables.match(/font-mono/g)).toHaveLength(2);
    expect(agentRow).not.toContain("@pier/ui/kbd.tsx");
    expect(agentRow).toContain("rounded-none border-0");
    expect(widgetLibrary).toContain("previewComponent");
    expect(widgetLibrary).toContain("group flex flex-col overflow-hidden");
  });

  it("keeps group-owned items inside their matching container", () => {
    const offenders: string[] = [];
    for (const filePath of files) {
      const relativePath = projectRelative(filePath);
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const stack: string[] = [];
      function visit(node: ts.Node): void {
        const isElement = ts.isJsxElement(node);
        const isSelfClosing = ts.isJsxSelfClosingElement(node);
        const name = isElement || isSelfClosing ? jsxName(node) : null;
        if (isElement && name) stack.push(name);
        const requiredGroup = name ? GROUP_BY_ITEM.get(name) : undefined;
        if (requiredGroup && !stack.includes(requiredGroup)) {
          const detachedGroup = DETACHED_ITEM_HELPERS.get(relativePath);
          if (
            detachedGroup !== requiredGroup ||
            !source.includes(requiredGroup)
          ) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1;
            offenders.push(`${relativePath}:${line}: ${name}`);
          }
        }
        ts.forEachChild(node, visit);
        if (isElement && name) stack.pop();
      }
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
  });

  it("lets controls own icon size and requires Button icon placement", () => {
    const offenders: string[] = [];
    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const icons = new Set(["Icon"]);
      for (const statement of sourceFile.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          statement.moduleSpecifier
            .getText(sourceFile)
            .includes("lucide-react") &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          for (const specifier of statement.importClause.namedBindings
            .elements) {
            icons.add(specifier.name.text);
          }
        }
      }
      const stack: string[] = [];
      function visit(node: ts.Node): void {
        const isElement = ts.isJsxElement(node);
        if (isElement) stack.push(jsxName(node));
        if (ts.isJsxSelfClosingElement(node) && icons.has(jsxName(node))) {
          const owner = [...stack]
            .reverse()
            .find((candidate) => ICON_CONTROL_OWNERS.has(candidate));
          if (owner) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1;
            const className = attribute(
              node,
              "className"
            )?.initializer?.getText(sourceFile);
            if (className && /\b(?:size|[wh])-/.test(className)) {
              offenders.push(
                `${projectRelative(filePath)}:${line}: ${owner} sizes icon`
              );
            }
            if (owner === "Button" && !attribute(node, "data-icon")) {
              offenders.push(
                `${projectRelative(filePath)}:${line}: Button icon placement`
              );
            }
          }
        }
        ts.forEachChild(node, visit);
        if (isElement) stack.pop();
      }
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the Codex account identity on shadcn Avatar", () => {
    const accountDisplay = readFileSync(
      join(ROOT, "packages/plugin-codex/src/renderer/account-display.tsx"),
      "utf8"
    );
    const styles = readFileSync(
      join(ROOT, "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );
    expect(accountDisplay).toContain("<Avatar");
    expect(accountDisplay).toContain("<AvatarFallback>");
    expect(accountDisplay).toContain('<ItemMedia align="center">');
    expect(accountDisplay).not.toContain("pier-codex-avatar");
    expect(styles).not.toContain(".pier-codex-avatar");
    expect(styles).not.toContain(".pier-codex-list-identity span");
  });

  it("keeps Codex empty states and typography on shared primitives", () => {
    const accountDisplay = readFileSync(
      join(ROOT, "packages/plugin-codex/src/renderer/account-display.tsx"),
      "utf8"
    );
    const styles = readFileSync(
      join(ROOT, "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );

    expect(accountDisplay).toContain('@pier/ui/empty.tsx"');
    expect(accountDisplay).toContain("<Empty");
    expect(accountDisplay).not.toContain("pier-codex-quota-empty");
    expect(styles).not.toMatch(/\bfont-(?:size|variant|weight):/);
    expect(styles).not.toContain("letter-spacing:");
    expect(styles).not.toMatch(/^\s*color:/m);
  });

  it("keeps Codex utilities aligned with the host style contract", () => {
    const rendererRoot = join(
      ROOT,
      "packages",
      "plugin-codex",
      "src",
      "renderer"
    );
    const rendererSources = sourceFiles(rendererRoot)
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");
    const styles = readFileSync(join(rendererRoot, "styles.css"), "utf8");

    expect(rendererSources).not.toContain("codex:");
    expect(styles).toContain('@reference "@pier/ui/tailwind-theme.css"');
    expect(styles).toContain("@scope ([data-pier-codex-scope])");
    expect(styles).not.toContain("prefix(codex)");
    expect(styles).not.toContain('@import "tailwindcss/utilities.css"');
    expect(styles).not.toContain('@import "tailwindcss/theme.css"');
  });
});
