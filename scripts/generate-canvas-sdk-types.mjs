#!/usr/bin/env node
/**
 * Generates standalone prop types for the Pier Canvas SDK.
 *
 * Reads `PIER_CANVAS_COMPONENT_EXPORT_NAMES` and
 * `PIER_CANVAS_VALUE_EXPORT_NAMES` from the shared export-names file, then
 * uses the TypeScript compiler API to parse `packages/ui/src/*.tsx` (and the
 * renderer lib files for host primitives like Stack/Row/Frame/Text).
 *
 * For each component it extracts the function's parameter type annotation and
 * serialises it to a standalone string that only references `react` types —
 * no `@pier/ui`, `radix-ui`, or `class-variance-authority` imports.
 *
 * Output: `resources/system-skills/pier-canvas/sdk/primitives.d.ts`
 * (plus `values.d.ts` if the total exceeds 500 lines).
 *
 * Usage: pnpm canvas-sdk:generate-types
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const repoRoot = resolve(process.cwd());

// ── 1. Parse export names ──────────────────────────────────────────────

function parseExportNames(filePath) {
  const src = readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
  const componentNames = [];
  const valueNames = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      const name = decl.name.getText(sf);
      let init = decl.initializer;
      if (init && ts.isAsExpression(init)) init = init.expression;
      if (!(init && ts.isArrayLiteralExpression(init))) continue;
      const names = init.elements.filter(ts.isStringLiteral).map((e) => e.text);
      if (name === "PIER_CANVAS_COMPONENT_EXPORT_NAMES")
        componentNames.push(...names);
      if (name === "PIER_CANVAS_VALUE_EXPORT_NAMES") valueNames.push(...names);
    }
  }
  return { componentNames, valueNames };
}

// ── 2. Collect source files ───────────────────────────────────────────

function collectFiles(dir, exts = [".tsx", ".ts"]) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

// ── 3. Create TS program ──────────────────────────────────────────────

function createProgram(uiFiles, extraFiles, exportNamesPath) {
  return ts.createProgram([...uiFiles, ...extraFiles, exportNamesPath], {
    target: ts.ScriptTarget.ES2024,
    lib: ["ES2024", "DOM", "DOM.Iterable"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    paths: {
      "@/*": [join(repoRoot, "src/renderer/*")],
      "@shared/*": [join(repoRoot, "src/shared/*")],
      "@main/*": [join(repoRoot, "src/main/*")],
      "@preload/*": [join(repoRoot, "src/preload/*")],
      "@plugins/*": [join(repoRoot, "src/plugins/*")],
      "@pier/ui/*": [join(repoRoot, "packages/ui/src/*")],
      "@pier/ui": [join(repoRoot, "packages/ui/src")],
    },
    baseUrl: repoRoot,
  });
}

// ── 4. Build export map ───────────────────────────────────────────────

function buildExportMap(program, checker) {
  const exportMap = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.fileName.includes(repoRoot)) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    const moduleSym = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSym) continue;
    for (const exp of checker.getExportsOfModule(moduleSym)) {
      if (exportMap.has(exp.name)) continue;
      exportMap.set(exp.name, exp);
    }
  }
  return exportMap;
}

function getFunctionDecl(checker, sym) {
  const decl = sym.valueDeclaration || sym.declarations?.[0];
  if (decl && ts.isExportSpecifier(decl)) {
    const aliased = checker.getAliasedSymbol(sym);
    return aliased.valueDeclaration || aliased.declarations?.[0];
  }
  return decl;
}

// ── 5. Element → React HTML attribute mapping ─────────────────────────

const ELEMENT_TO_ATTRS = {
  button: "ButtonHTMLAttributes<HTMLButtonElement>",
  div: "HTMLAttributes<HTMLDivElement>",
  span: "HTMLAttributes<HTMLSpanElement>",
  nav: "HTMLAttributes<HTMLElement>",
  ol: "HTMLAttributes<HTMLOListElement>",
  li: "HTMLAttributes<HTMLLIElement>",
  a: "AnchorHTMLAttributes<HTMLAnchorElement>",
  p: "HTMLAttributes<HTMLParagraphElement>",
  h2: "HTMLAttributes<HTMLHeadingElement>",
  ul: "HTMLAttributes<HTMLUListElement>",
  table: "TableHTMLAttributes<HTMLTableElement>",
  thead: "HTMLAttributes<HTMLTableSectionElement>",
  tbody: "HTMLAttributes<HTMLTableSectionElement>",
  tfoot: "HTMLAttributes<HTMLTableSectionElement>",
  tr: "HTMLAttributes<HTMLTableRowElement>",
  th: "ThHTMLAttributes<HTMLTableCellElement>",
  td: "TdHTMLAttributes<HTMLTableCellElement>",
  caption: "HTMLAttributes<HTMLTableCaptionElement>",
  fieldset: "HTMLAttributes<HTMLFieldSetElement>",
  legend: "HTMLAttributes<HTMLLegendElement>",
  svg: "SVGProps<SVGSVGElement>",
  kbd: "HTMLAttributes<HTMLElement>",
  input: "InputHTMLAttributes<HTMLInputElement>",
  textarea: "TextareaHTMLAttributes<HTMLTextAreaElement>",
};

// Radix component → base HTML element (resolved via type checker)
const RADIX_BASE_ELEMENT = {
  Accordion: "HTMLDivElement",
  AccordionItem: "HTMLDivElement",
  AccordionTrigger: "HTMLButtonElement",
  AccordionContent: "HTMLDivElement",
  Separator: "HTMLDivElement",
  Avatar: "HTMLSpanElement",
  AvatarImage: "HTMLImageElement",
  AvatarFallback: "HTMLSpanElement",
  AvatarBadge: "HTMLSpanElement",
  AvatarGroup: "HTMLDivElement",
  AvatarGroupCount: "HTMLDivElement",
  Progress: "HTMLDivElement",
  Collapsible: "HTMLDivElement",
  CollapsibleTrigger: "HTMLButtonElement",
  CollapsibleContent: "HTMLDivElement",
  Tabs: "HTMLDivElement",
  TabsList: "HTMLDivElement",
  TabsTrigger: "HTMLButtonElement",
  TabsContent: "HTMLDivElement",
  TooltipTrigger: "HTMLButtonElement",
  TooltipContent: "HTMLDivElement",
  HoverCardTrigger: "HTMLAnchorElement",
  HoverCardContent: "HTMLDivElement",
  PopoverTrigger: "HTMLButtonElement",
  PopoverContent: "HTMLDivElement",
  PopoverAnchor: "HTMLDivElement",
  DropdownMenuTrigger: "HTMLButtonElement",
  DropdownMenuContent: "HTMLDivElement",
  DropdownMenuItem: "HTMLDivElement",
  DropdownMenuCheckboxItem: "HTMLDivElement",
  DropdownMenuRadioItem: "HTMLDivElement",
  DropdownMenuLabel: "HTMLDivElement",
  DropdownMenuSeparator: "HTMLDivElement",
  DropdownMenuSubTrigger: "HTMLDivElement",
  DropdownMenuSubContent: "HTMLDivElement",
  Label: "HTMLLabelElement",
  Checkbox: "HTMLButtonElement",
  RadioGroup: "HTMLDivElement",
  RadioGroupItem: "HTMLButtonElement",
  SelectTrigger: "HTMLButtonElement",
  SelectItem: "HTMLDivElement",
  SelectGroup: "HTMLDivElement",
  SelectLabel: "HTMLDivElement",
  SelectSeparator: "HTMLDivElement",
  SelectScrollUpButton: "HTMLDivElement",
  SelectScrollDownButton: "HTMLDivElement",
  Switch: "HTMLButtonElement",
  Slider: "HTMLSpanElement",
  AspectRatio: "HTMLDivElement",
};

// Map element name to the HTMLAttributes type
function elementToAttrs(element) {
  return ELEMENT_TO_ATTRS[element] || "HTMLAttributes<HTMLElement>";
}

// ── 6. Find cva variant definitions ──────────────────────────────────

function findCvaVariants(sourceFile, cvaVarName) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (decl.name.getText() !== cvaVarName || !decl.initializer) continue;
      const init = decl.initializer;
      if (!ts.isCallExpression(init)) continue;
      const arg2 = init.arguments[1];
      if (!(arg2 && ts.isObjectLiteralExpression(arg2))) continue;
      for (const prop of arg2.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (prop.name.getText() !== "variants") continue;
        if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
        const variants = {};
        for (const variantProp of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(variantProp)) continue;
          const variantName = variantProp.name.getText();
          const values = [];
          if (ts.isObjectLiteralExpression(variantProp.initializer)) {
            for (const val of variantProp.initializer.properties) {
              const valName =
                ts.isPropertyAssignment(val) ||
                ts.isShorthandPropertyAssignment(val)
                  ? val.name.getText()
                  : "";
              if (valName) values.push(valName);
            }
          }
          variants[variantName] = values;
        }
        return variants;
      }
    }
  }
  return null;
}

// Format variant values as a union type string
function formatVariantUnion(values) {
  const formatted = values.map((v) => {
    // Already quoted (e.g. "status-bar")
    if (v.startsWith('"')) return v;
    return `"${v}"`;
  });
  return formatted.join(" | ");
}

// Generate VariantProps as an inline type
function variantPropsToType(variants) {
  const parts = [];
  for (const [name, values] of Object.entries(variants)) {
    const union = formatVariantUnion(values);
    parts.push(`${name}?: ${union} | null;`);
  }
  return `{ ${parts.join(" ")} }`;
}

// ── 7. Find named type declarations ───────────────────────────────────

function findNamedTypeInFile(sourceFile, typeName) {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName)
      return stmt;
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName)
      return stmt;
  }
  return null;
}

function findNamedTypeAnywhere(program, typeName) {
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.fileName.includes(repoRoot)) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    const found = findNamedTypeInFile(sourceFile, typeName);
    if (found) return { node: found, sourceFile };
  }
  return null;
}

// ── 7b. Names curated in sibling SDK declaration files ────────────────

/**
 * Names already declared by the curated sibling SDK files (core/files/
 * forms/visualizations). `index.d.ts` re-exports all of them, so
 * primitives.d.ts must not redeclare them (TS2308 duplicate export), and
 * named types that live there are imported from the sibling instead of
 * inlined.
 */
function parseSiblingDeclaredExports(sdkDir) {
  const declared = new Map(); // name -> { base, kind: "value" | "type" }
  for (const entry of readdirSync(sdkDir)) {
    if (
      !entry.endsWith(".d.ts") ||
      entry === "index.d.ts" ||
      entry === "primitives.d.ts"
    ) {
      continue;
    }
    const base = entry.replace(/\.d\.ts$/, "");
    const filePath = join(sdkDir, entry);
    const src = readFileSync(filePath, "utf8");
    const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);
    for (const stmt of sf.statements) {
      const isExported =
        ts.canHaveModifiers(stmt) &&
        ts
          .getModifiers(stmt)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name))
            declared.set(d.name.text, { base, kind: "value" });
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        declared.set(stmt.name.text, { base, kind: "value" });
      } else if (
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt)
      ) {
        declared.set(stmt.name.text, { base, kind: "type" });
      }
    }
  }
  return declared;
}

// ── 7c. Bare named-type resolution ────────────────────────────────────

// React types the generator may emit; imported in the header when used.
const REACT_TYPE_NAMES = new Set([
  "ComponentType",
  "CSSProperties",
  "ReactNode",
  "HTMLAttributes",
  "ButtonHTMLAttributes",
  "ImgHTMLAttributes",
  "AnchorHTMLAttributes",
  "LabelHTMLAttributes",
  "InputHTMLAttributes",
  "TextareaHTMLAttributes",
  "TableHTMLAttributes",
  "TdHTMLAttributes",
  "ThHTMLAttributes",
  "SVGProps",
  "HTMLAttributeReferrerPolicy",
]);

// Global/lib types that need no import and must never be inlined or
// replaced by the fallback.
const GLOBAL_TYPE_NAMES = new Set([
  "Record",
  "Pick",
  "Omit",
  "Partial",
  "Required",
  "Readonly",
  "ReadonlySet",
  "Array",
  "ReadonlyArray",
  "Promise",
  "Date",
  "Function",
  "Object",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "Element",
  "DocumentFragment",
  "HTMLElement",
  "SVGElement",
  "Node",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "BigInt",
  "JSON",
  "Math",
]);

/**
 * Replace bare identifiers in emitted text that resolve to local named types
 * (e.g. `ScrollAreaViewportFade`) with their inlined definitions, and rewrite
 * sibling SDK types into `import type` references. React and global types pass
 * through untouched; unknown identifiers are left as-is.
 */
function resolveBareNamedTypes(text, context) {
  return text.replace(/\b([A-Z][A-Za-z0-9_]*)\b/g, (match, name) => {
    if (REACT_TYPE_NAMES.has(name) || GLOBAL_TYPE_NAMES.has(name)) return match;
    const sibling = context.siblingDeclared.get(name);
    if (sibling && sibling.kind === "type") {
      context.siblingTypeImports.set(name, sibling.base);
      return match;
    }
    if (context.inliningStack.has(name)) return "Record<string, unknown>";
    const found = findNamedTypeAnywhere(context.program, name);
    if (found) {
      return inlineNamedType(found.node, found.sourceFile, context);
    }
    return match;
  });
}

/**
 * Build `import type { X } from "./<sibling>.js"` lines for named types that
 * live in curated sibling SDK files, in a stable file order.
 */
function buildSiblingImportLines(siblingTypeImports) {
  const byFile = new Map();
  for (const [name, base] of siblingTypeImports) {
    if (!byFile.has(base)) byFile.set(base, []);
    byFile.get(base).push(name);
  }
  const lines = [];
  for (const base of ["core", "files", "forms", "visualizations"]) {
    const names = byFile.get(base);
    if (names?.length) {
      lines.push(`import type { ${names.join(", ")} } from "./${base}.js";`);
    }
  }
  return lines.join("\n");
}

// ── 8. Get component-specific props for Radix components ──────────────

// Standard HTML attribute names to exclude when extracting component-specific props
const STANDARD_HTML_PROPS = new Set([
  "key",
  "ref",
  "slot",
  "style",
  "title",
  "className",
  "children",
  "id",
  "lang",
  "dir",
  "hidden",
  "tabIndex",
  "accessKey",
  "contentEditable",
  "contextMenu",
  "draggable",
  "spellCheck",
  "translate",
  "autoCapitalize",
  "autoFocus",
  "role",
  "nonce",
  "content",
  "data",
  "suppressContentEditableWarning",
  "suppressHydrationWarning",
  // Form-related
  "name",
  "disabled",
  "required",
  "form",
  "autoFocus",
  "autoComplete",
  "defaultValue",
  "defaultChecked",
  "value",
  "checked",
  // Common HTML attrs that overlap with Radix
  "type",
  "placeholder",
  "readOnly",
  "multiple",
  "size",
  "src",
  "alt",
  "href",
  "target",
  "rel",
  "download",
  "hrefLang",
  "media",
  "ping",
  "coords",
  "shape",
  "tabIndex",
]);

function isEventHandler(name) {
  return (
    name.startsWith("on") &&
    name.length > 2 &&
    name[2] === name[2].toUpperCase()
  );
}

function isAriaOrData(name) {
  return name.startsWith("aria-") || name.startsWith("data-");
}

// ── 9. Type serializer ───────────────────────────────────────────────

/**
 * Convert a type annotation AST node to a standalone string.
 * Handles intersection types, type references, inline types, etc.
 */
function serializeTypeNode(typeNode, sourceFile, context) {
  const printer = ts.createPrinter();
  const raw = printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile);

  // Handle intersection types: A & B & C
  if (ts.isIntersectionTypeNode(typeNode)) {
    const parts = typeNode.types.map((t) =>
      serializeTypeNode(t, sourceFile, context)
    );
    // Filter out empty parts
    const nonEmpty = parts.filter((p) => p.trim());
    if (nonEmpty.length === 0) return "Record<string, unknown>";
    if (nonEmpty.length === 1) return nonEmpty[0];
    return nonEmpty.join(" & ");
  }

  // Handle parenthesized types
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return serializeTypeNode(typeNode.type, sourceFile, context);
  }

  // Handle union types: recurse so named members resolve
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .map((t) => serializeTypeNode(t, sourceFile, context))
      .join(" | ");
  }

  // Handle type references (React.ComponentProps, VariantProps, named types)
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName.getText(sourceFile);
    const typeArgs = typeNode.typeArguments;

    // React.ComponentProps<"element">
    if (
      typeName.includes("ComponentProps") &&
      typeArgs &&
      typeArgs.length === 1
    ) {
      const arg = typeArgs[0];
      // String literal element
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        const element = arg.literal.text;
        return elementToAttrs(element);
      }
      // typeof X.Y (Radix component)
      if (ts.isTypeQueryNode(arg)) {
        const exprName = arg.exprName.getText(sourceFile);
        return resolveTypofComponentProps(exprName, sourceFile, context);
      }
    }

    // ComponentProps (without React. prefix)
    if (typeName === "ComponentProps" && typeArgs && typeArgs.length === 1) {
      const arg = typeArgs[0];
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        return elementToAttrs(arg.literal.text);
      }
    }

    // VariantProps<typeof cvaVar>
    if (typeName === "VariantProps" && typeArgs && typeArgs.length === 1) {
      const arg = typeArgs[0];
      if (ts.isTypeQueryNode(arg)) {
        const cvaName = arg.exprName.getText(sourceFile);
        const variants = findCvaVariants(sourceFile, cvaName);
        if (variants) {
          return variantPropsToType(variants);
        }
        // Fallback: VariantProps with no resolved variants
        return "Record<string, unknown>";
      }
    }

    // Omit<T, "key"> - handle Omit of ComponentProps
    if (typeName === "Omit" && typeArgs && typeArgs.length === 2) {
      const inner = serializeTypeNode(typeArgs[0], sourceFile, context);
      const omitKeys = serializeTypeNode(typeArgs[1], sourceFile, context);
      return `Omit<${inner}, ${omitKeys}>`;
    }

    // Pick<T, "key">
    if (typeName === "Pick" && typeArgs && typeArgs.length === 2) {
      const inner = serializeTypeNode(typeArgs[0], sourceFile, context);
      const pickKeys = serializeTypeNode(typeArgs[1], sourceFile, context);
      return `Pick<${inner}, ${pickKeys}>`;
    }

    // Named type reference (e.g. ScrollAreaProps, PaginationLinkProps, StatusIconKind)
    // Check if it's a locally-defined type that needs inlining
    if (!typeName.includes(".") && typeArgs === undefined) {
      // Prefer the curated sibling SDK declaration over inlining
      const sibling = context.siblingDeclared.get(typeName);
      if (sibling && sibling.kind === "type") {
        context.siblingTypeImports.set(typeName, sibling.base);
        return typeName;
      }
      const found = findNamedTypeAnywhere(context.program, typeName);
      if (found) {
        // Recursion guard: a self-referential type can't be inlined; fall
        // back to a safe structural type instead of a bare undeclared name
        if (context.inliningStack.has(typeName)) {
          return "Record<string, unknown>";
        }
        // Inline the type
        return inlineNamedType(found.node, found.sourceFile, context);
      }
      // Not declared in the program: keep global/lib types (Element,
      // DocumentFragment, ...) as-is, but never emit a bare undeclared name.
      if (!context.checker.getSymbolAtLocation(typeNode.typeName)) {
        return "CanvasPrimitiveProps & Record<string, unknown>";
      }
    }

    // Fallback: return as-is but strip React. prefixes
    return resolveBareNamedTypes(raw.replace(/React\./g, ""), context);
  }

  // Handle type query (typeof X)
  if (ts.isTypeQueryNode(typeNode)) {
    const exprName = typeNode.exprName.getText(sourceFile);
    return resolveTypofComponentProps(exprName, sourceFile, context);
  }

  // Handle inline type literal: recurse into members so named types and
  // React.ReactNode inside literals resolve
  if (ts.isTypeLiteralNode(typeNode)) {
    return serializeTypeLiteral(typeNode, sourceFile, context);
  }

  // Default: return raw text with React. prefixes stripped
  return resolveBareNamedTypes(raw.replace(/React\./g, ""), context);
}

/**
 * Serialize an inline type literal member-by-member so that named type
 * references inside it (e.g. `StatusIconKind`) are resolved instead of
 * leaking as bare undeclared names.
 */
function serializeTypeLiteral(node, sourceFile, context) {
  const printer = ts.createPrinter();
  const parts = [];
  for (const member of node.members) {
    if (ts.isPropertySignature(member)) {
      const readonly =
        ts.canHaveModifiers(member) &&
        ts
          .getModifiers(member)
          ?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword)
          ? "readonly "
          : "";
      const name = member.name.getText(sourceFile);
      const question = member.questionToken ? "?" : "";
      const type = member.type
        ? serializeTypeNode(member.type, sourceFile, context)
        : "unknown";
      parts.push(`${readonly}${name}${question}: ${type};`);
    } else if (ts.isMethodSignature(member)) {
      const name = member.name.getText(sourceFile);
      const question = member.questionToken ? "?" : "";
      const params = member.parameters
        .map((p) => {
          const pName = p.name.getText(sourceFile);
          const pOpt = p.questionToken ? "?" : "";
          const pType = p.type
            ? serializeTypeNode(p.type, sourceFile, context)
            : "unknown";
          return `${pName}${pOpt}: ${pType}`;
        })
        .join(", ");
      const ret = member.type
        ? serializeTypeNode(member.type, sourceFile, context)
        : "void";
      parts.push(`${name}${question}(${params}): ${ret};`);
    } else if (ts.isIndexSignatureDeclaration(member)) {
      const pName = member.parameters[0]?.name.getText(sourceFile) ?? "key";
      const pType = member.parameters[0]?.type
        ? serializeTypeNode(member.parameters[0].type, sourceFile, context)
        : "string";
      const type = member.type
        ? serializeTypeNode(member.type, sourceFile, context)
        : "unknown";
      parts.push(`[${pName}: ${pType}]: ${type};`);
    } else {
      // Uncommon member kinds (getters, call signatures): keep as printed
      const text = printer
        .printNode(ts.EmitHint.Unspecified, member, sourceFile)
        .replace(/;$/u, "")
        .replace(/React\./g, "");
      parts.push(`${resolveBareNamedTypes(text, context)};`);
    }
  }
  return `{ ${parts.join(" ")} }`;
}

function resolveTypofComponentProps(exprName, _sourceFile, context) {
  // e.g. "AccordionPrimitive.Root" or "Button"
  // For Radix: try to find the base element and component-specific props
  // For local components (like Button referenced from PaginationLink): resolve recursively

  // Check if it's a reference to another component in our export map
  const parts = exprName.split(".");
  const rootName = parts[0];
  if (parts.length > 1) {
    // Radix primitive reference - try to resolve via the component name
    // This is handled by the calling component's Radix base element lookup
    return "HTMLAttributes<HTMLElement>"; // fallback
  }

  // Reference to a local component (e.g. typeof Button in PaginationLink)
  const entry = context.exportMap.get(rootName);
  if (entry) {
    const decl = getFunctionDecl(context.checker, entry);
    if (decl && ts.isFunctionDeclaration(decl)) {
      const param = decl.parameters[0];
      if (param?.type) {
        return serializeTypeNode(param.type, decl.getSourceFile(), context);
      }
    }
  }

  return "Record<string, unknown>";
}

function inlineNamedType(node, sourceFile, context) {
  if (context.inliningStack.has(node.name.text)) {
    return "Record<string, unknown>";
  }
  context.inliningStack.add(node.name.text);
  try {
    return inlineNamedTypeInner(node, sourceFile, context);
  } finally {
    context.inliningStack.delete(node.name.text);
  }
}

function inlineNamedTypeInner(node, sourceFile, context) {
  if (ts.isInterfaceDeclaration(node)) {
    // Serialize the interface
    const printer = ts.createPrinter();
    const _text = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);

    // If it extends React.ComponentProps<typeof X>, resolve the extends
    // and convert to an intersection type
    if (node.heritageClauses) {
      const parts = [];
      // Add the interface body as an inline type
      const members = node.members
        .map((m) => {
          const memberText = printer.printNode(
            ts.EmitHint.Unspecified,
            m,
            sourceFile
          );
          return memberText.replace(/;$/u, "");
        })
        .join("; ");
      const inlineBody = members ? `{ ${members}; }` : "{}";

      for (const hc of node.heritageClauses) {
        for (const t of hc.types) {
          const serialized = serializeTypeNode(t, sourceFile, context);
          parts.push(serialized);
        }
      }
      parts.push(inlineBody);
      return parts.join(" & ");
    }

    // Simple interface without heritage - convert to inline type
    const members = node.members
      .map((m) => {
        const memberText = printer.printNode(
          ts.EmitHint.Unspecified,
          m,
          sourceFile
        );
        return memberText.replace(/;$/u, "");
      })
      .join("; ");
    return members ? `{ ${members}; }` : "{}";
  }

  if (ts.isTypeAliasDeclaration(node)) {
    // Serialize the type alias body
    return serializeTypeNode(node.type, sourceFile, context);
  }

  return "Record<string, unknown>";
}

// ── 10. Get Radix component-specific props ───────────────────────────

function getRadixSpecificProps(
  checker,
  exportMap,
  componentName,
  _decl,
  context
) {
  const entry = exportMap.get(componentName);
  if (!entry) return [];
  const sym = entry;
  const fnDecl = getFunctionDecl(checker, sym);
  if (!(fnDecl && ts.isFunctionDeclaration(fnDecl))) return [];
  const param = fnDecl.parameters[0];
  if (!param) return [];

  const propsType = checker.getTypeAtLocation(param);
  const props = propsType.getProperties();

  const specificProps = [];
  for (const prop of props) {
    const propName = prop.name;
    if (isAriaOrData(propName)) continue;
    if (isEventHandler(propName)) continue;
    if (STANDARD_HTML_PROPS.has(propName)) continue;

    const propType = checker.getTypeOfSymbolAtLocation(prop, fnDecl);
    const typeNode = checker.typeToTypeNode(
      propType,
      fnDecl,
      ts.NodeBuilderFlags.NoTruncation
    );
    if (typeNode) {
      const printer = ts.createPrinter();
      const src = ts.createSourceFile(
        "temp.ts",
        "",
        ts.ScriptTarget.Latest,
        false
      );
      const text = printer.printNode(ts.EmitHint.Unspecified, typeNode, src);
      // biome-ignore lint/suspicious/noBitwiseOperators: TS symbol flags are bitmask constants.
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      // Clean up the type text - remove undefined for optional props and
      // inline any bare local named types (e.g. ScrollAreaViewportFade)
      const cleanType = resolveBareNamedTypes(
        text.replace(/\s*\|\s*undefined$/, "").replace(/React\./g, ""),
        context
      );
      specificProps.push(`${propName}${isOptional ? "?" : ""}: ${cleanType}`);
    }
  }
  return specificProps;
}

// ── 11. Main generation ───────────────────────────────────────────────

function generate() {
  const exportNamesPath = join(
    repoRoot,
    "src/shared/pier-canvas-export-names.ts"
  );
  const { componentNames, valueNames } = parseExportNames(exportNamesPath);

  const sdkDir = join(repoRoot, "resources/system-skills/pier-canvas/sdk");
  const siblingDeclared = parseSiblingDeclaredExports(sdkDir);

  const uiSrcDir = join(repoRoot, "packages/ui/src");
  const uiFiles = collectFiles(uiSrcDir);

  const rendererLibDir = join(repoRoot, "src/renderer/lib/live-modules");
  const extraFiles = collectFiles(rendererLibDir);

  const program = createProgram(uiFiles, extraFiles, exportNamesPath);
  const checker = program.getTypeChecker();
  const exportMap = buildExportMap(program, checker);

  const context = {
    program,
    checker,
    exportMap,
    inliningStack: new Set(), // names currently being inlined (recursion guard)
    siblingDeclared, // name -> { base, kind } from curated SDK files
    siblingTypeImports: new Map(), // sibling type name -> sibling file base
  };

  // Process each component
  const componentDecls = [];

  for (const name of componentNames) {
    // Names curated in sibling SDK files (core/files/forms/visualizations)
    // are already exported there; redeclaring them here would duplicate the
    // export (TS2308) and shadow the curated declaration.
    if (siblingDeclared.has(name)) continue;

    const entry = exportMap.get(name);
    if (!entry) {
      // Not exported by @pier/ui or the renderer lib — nothing to emit.
      continue;
    }

    const decl = getFunctionDecl(checker, entry);
    if (!(decl && ts.isFunctionDeclaration(decl))) {
      // Some components might be exported differently
      componentDecls.push(`export const ${name}: CanvasPrimitive;`);
      continue;
    }

    const param = decl.parameters[0];
    if (!param?.type) {
      componentDecls.push(`export const ${name}: CanvasPrimitive;`);
      continue;
    }

    const sourceFile = decl.getSourceFile();
    const propsType = serializeTypeNode(param.type, sourceFile, context);

    // Check if this is a Radix component with specific props
    const baseElement = RADIX_BASE_ELEMENT[name];
    if (baseElement) {
      // Get component-specific props (non-HTML)
      const specificProps = getRadixSpecificProps(
        checker,
        exportMap,
        name,
        decl,
        context
      );

      // Build the props type: HTMLAttributes<Element> & { specificProps }
      if (specificProps.length > 0) {
        const propsStr = specificProps.join("; ");
        const fullType = `${elementToAttrsForElement(baseElement)} & { ${propsStr}; }`;
        componentDecls.push(
          `export const ${name}: ComponentType<${fullType}>;`
        );
      } else {
        componentDecls.push(
          `export const ${name}: ComponentType<${elementToAttrsForElement(baseElement)}>;`
        );
      }
    } else if (isRootComponent(name)) {
      // Root components have specific props but no base HTML element.
      const specificProps = getRadixSpecificProps(
        checker,
        exportMap,
        name,
        decl,
        context
      );
      if (specificProps.length > 0) {
        const propsStr = specificProps.join("; ");
        componentDecls.push(
          `export const ${name}: ComponentType<{ ${propsStr}; } & Record<string, unknown>>;`
        );
      } else {
        componentDecls.push(
          `export const ${name}: ComponentType<Record<string, unknown>>;`
        );
      }
    } else {
      // Regular component with serialized props type
      componentDecls.push(`export const ${name}: ComponentType<${propsType}>;`);
    }
  }

  // Process value exports (hooks)
  const valueDecls = [];
  for (const name of valueNames) {
    // useCanvasFile is curated in files.d.ts — skip it here.
    if (siblingDeclared.has(name)) continue;

    const entry = exportMap.get(name);
    if (!entry) continue;
    const decl = getFunctionDecl(checker, entry);
    if (!(decl && ts.isFunctionDeclaration(decl))) {
      valueDecls.push(`export const ${name}: (...args: unknown[]) => unknown;`);
      continue;
    }

    // Get the function signature
    const sig = checker.getSignatureFromDeclaration(decl);
    if (sig) {
      const params = sig.getParameters();
      const paramStrs = params.map((p) => {
        const paramType = checker.getTypeOfSymbolAtLocation(p, decl);
        const typeNode = checker.typeToTypeNode(
          paramType,
          decl,
          ts.NodeBuilderFlags.NoTruncation
        );
        if (typeNode) {
          const printer = ts.createPrinter();
          const src = ts.createSourceFile(
            "temp.ts",
            "",
            ts.ScriptTarget.Latest,
            false
          );
          const text = printer
            .printNode(ts.EmitHint.Unspecified, typeNode, src)
            .replace(/React\./g, "");
          return `${p.name}: ${resolveBareNamedTypes(text, context)}`;
        }
        return `${p.name}: unknown`;
      });

      const retType = sig.getReturnType();
      const retNode = checker.typeToTypeNode(
        retType,
        decl,
        ts.NodeBuilderFlags.NoTruncation
      );
      let retStr = "unknown";
      if (retNode) {
        const printer = ts.createPrinter();
        const src = ts.createSourceFile(
          "temp.ts",
          "",
          ts.ScriptTarget.Latest,
          false
        );
        retStr = printer
          .printNode(ts.EmitHint.Unspecified, retNode, src)
          .replace(/React\./g, "");
        retStr = resolveBareNamedTypes(retStr, context);
      }

      valueDecls.push(
        `export function ${name}(${paramStrs.join(", ")}): ${retStr};`
      );
    } else {
      valueDecls.push(`export const ${name}: (...args: unknown[]) => unknown;`);
    }
  }

  // Build the output file
  const fallback = `/** Fallback for components whose props could not be resolved. */
export interface CanvasPrimitiveProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  [prop: string]: unknown;
}

export type CanvasPrimitive = ComponentType<CanvasPrimitiveProps>;

`;

  const body = componentDecls.join("\n");
  const valuesBody = valueDecls.join("\n");

  let content = fallback + body;
  if (valuesBody) content += `\n\n${valuesBody}`;
  content += "\n";
  // Defensive pass: inline any bare local named types that slipped through.
  content = resolveBareNamedTypes(content, context);

  // Header imports: only the react types actually used, plus `import type`
  // lines for named types that live in curated sibling SDK files.
  const reactImportNames = [...REACT_TYPE_NAMES].filter((name) =>
    new RegExp(`\\b${name}\\b`).test(content)
  );
  const reactImportLine = `import type { ${reactImportNames.join(", ")} } from "react";`;
  const siblingImportLine = buildSiblingImportLines(context.siblingTypeImports);

  const header = `${reactImportLine}${siblingImportLine ? `\n${siblingImportLine}` : ""}

/**
 * Generated prop types for Pier Canvas SDK primitives.
 *
 * DO NOT EDIT — regenerate with \`pnpm canvas-sdk:generate-types\`.
 * These types are extracted from \`packages/ui/src/*.tsx\` and inlined
 * so the SDK is standalone (no \`@pier/ui\` dependency).
 */

`;

  // React's HTMLAttributes use `any` for RDFa props; `unknown` is safer for
  // consumer typechecking and satisfies the repo's no-explicit-any lint.
  const sanitized = (header + content).replace(
    /(\?\s*:\s*)any\s*(?=[;,}])/gu,
    "$1unknown"
  );
  writeFileSync(join(sdkDir, "primitives.d.ts"), sanitized, "utf8");

  console.log(
    `Generated primitives.d.ts (${sanitized.split("\n").length} lines)`
  );
  console.log(`  Components: ${componentDecls.length}`);
  console.log(`  Value exports: ${valueDecls.length}`);
}

function elementToAttrsForElement(element) {
  // Map element type name to HTMLAttributes
  const map = {
    HTMLButtonElement: "ButtonHTMLAttributes<HTMLButtonElement>",
    HTMLDivElement: "HTMLAttributes<HTMLDivElement>",
    HTMLSpanElement: "HTMLAttributes<HTMLSpanElement>",
    HTMLImageElement: "ImgHTMLAttributes<HTMLImageElement>",
    HTMLAnchorElement: "AnchorHTMLAttributes<HTMLAnchorElement>",
    HTMLLabelElement: "LabelHTMLAttributes<HTMLLabelElement>",
    HTMLParagraphElement: "HTMLAttributes<HTMLParagraphElement>",
    HTMLHeadingElement: "HTMLAttributes<HTMLHeadingElement>",
    HTMLLIElement: "HTMLAttributes<HTMLLIElement>",
    HTMLOListElement: "HTMLAttributes<HTMLOListElement>",
    HTMLUListElement: "HTMLAttributes<HTMLUListElement>",
    HTMLTableElement: "TableHTMLAttributes<HTMLTableElement>",
    HTMLTableSectionElement: "HTMLAttributes<HTMLTableSectionElement>",
    HTMLTableRowElement: "HTMLAttributes<HTMLTableRowElement>",
    HTMLTableCellElement: "HTMLAttributes<HTMLTableCellElement>",
    HTMLTableCaptionElement: "HTMLAttributes<HTMLTableCaptionElement>",
    HTMLFieldSetElement: "HTMLAttributes<HTMLFieldSetElement>",
    HTMLLegendElement: "HTMLAttributes<HTMLLegendElement>",
    HTMLElement: "HTMLAttributes<HTMLElement>",
  };
  return map[element] || "HTMLAttributes<HTMLElement>";
}

// Root components that don't render a specific HTML element
const ROOT_COMPONENTS = new Set([
  "Tooltip",
  "TooltipProvider",
  "HoverCard",
  "Popover",
  "DropdownMenu",
  "DropdownMenuPortal",
  "DropdownMenuGroup",
  "DropdownMenuRadioGroup",
  "DropdownMenuSub",
  "Select",
  "SelectValue",
  "SelectContent",
  "ScrollArea",
  "ScrollBar",
]);

function isRootComponent(name) {
  return ROOT_COMPONENTS.has(name);
}

generate();
